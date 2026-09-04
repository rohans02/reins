import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth/session'
import { runAgent } from '@/lib/agent/loop'
import { selectModel } from '@/lib/agent/select'

/**
 * POST /api/agent/run — starts the buyer agent and streams its events as SSE.
 * AI: yes (the agent loop). Razorpay: indirectly, on ALLOW only.
 */
export async function POST(request: Request) {
  const { mandateId, task, forceAttempt } = (await request.json()) as {
    mandateId?: string
    task?: string
    /**
     * Simulate an agent that has already been taken in by the injection.
     */
    forceAttempt?: boolean
  }

  if (!mandateId || !task) {
    return Response.json({ error: 'mandateId and task are required' }, { status: 400 })
  }

  // Ownership is settled BEFORE the stream opens. Refusing mid-stream would
  // mean a run row already existed against somebody else's mandate, and the
  // error would arrive as an SSE event rather than an HTTP status.
  const actorUserId = await currentUserId()
  if (!actorUserId) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const mandate = await prisma.mandate.findUnique({
    where: { id: mandateId },
    select: { userId: true },
  })
  if (!mandate || mandate.userId !== actorUserId) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const { model, scripted, provider } = selectModel()
  // The script already contains the out-of-bounds attempt, so the toggle only
  // means anything to a live model.
  const attemptOutOfBounds = scripted ? false : Boolean(forceAttempt)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))

      try {
        send({
          type: 'mode',
          scripted,
          provider,
          modelName: model.name,
          forceAttempt: attemptOutOfBounds,
        })
        for await (const event of runAgent({
          mandateId,
          actorUserId,
          task,
          model,
          forceAttempt: attemptOutOfBounds,
        })) {
          send(event)
        }
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
