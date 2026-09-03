import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth/session'
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

  // Ownership is settled BEFORE the stream opens. Refusing mid-stream would
  // mean a run row already existed against somebody else's mandate, and the
  // error would arrive as an SSE event rather than an HTTP status.
  const actorUserId = await currentUserId()
  const mandate = await prisma.mandate.findUnique({
    where: { id: mandateId },
    select: { userId: true },
  })
  if (!mandate || mandate.userId !== actorUserId) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const { model, scripted } = selectModel()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      try {
        send({ type: 'mode', scripted })
        for await (const event of runAgent({ mandateId, actorUserId, task, model })) send(event)
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
