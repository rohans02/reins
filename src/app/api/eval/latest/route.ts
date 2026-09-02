import { prisma } from '@/lib/db'
import type { EvalMetrics } from '@/lib/eval/runner'

/** GET /api/eval/latest — most recent suite results. AI: no. Razorpay: no. */
export async function GET() {
  const run = await prisma.evalRun.findFirst({ orderBy: { createdAt: 'desc' } })
  if (!run) return Response.json({ metrics: null })

  return Response.json({
    evalRunId: run.id,
    ranAt: run.createdAt,
    metrics: JSON.parse(run.resultsJson) as EvalMetrics,
  })
}
