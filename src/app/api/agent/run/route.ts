import { runAgent } from '@/lib/agent/loop'
import { selectModel } from '@/lib/agent/select'

/**
 * POST /api/agent/run — starts the buyer agent and streams its events as SSE.
 * AI: yes (the agent loop). Razorpay: indirectly, on ALLOW only.
 *
 * Plain Web ReadableStream rather than a streaming SDK — the loop is already an
 * async generator, so this is a dozen lines and adds no dependency.
 *
 * `no-transform` matters: a proxy that buffers the response would hold every
 * event until the run finished, which would silently destroy the live feel the
 * whole demo depends on.
 */
export async function POST(request: Request) {
  const { mandateId, task } = (await request.json()) as { mandateId?: string; task?: string }

  if (!mandateId || !task) {
    return Response.json({ error: 'mandateId and task are required' }, { status: 400 })
  }

  const { model, scripted } = selectModel()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      try {
        send({ type: 'mode', scripted })
        for await (const event of runAgent({ mandateId, task, model })) send(event)
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
