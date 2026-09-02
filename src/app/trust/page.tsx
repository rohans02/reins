import { prisma } from '@/lib/db'
import { TrustReport } from '@/components/TrustReport'
import type { EvalMetrics } from '@/lib/eval/runner'

/**
 * Trust Report — the metrics deliverable.
 * Server-rendered from the most recent run so the page arrives with numbers in
 * it; the client half only re-runs the suite on demand.
 */
export const dynamic = 'force-dynamic'

export default async function TrustPage() {
  const run = await prisma.evalRun.findFirst({ orderBy: { createdAt: 'desc' } })

  return (
    <TrustReport
      initialMetrics={run ? (JSON.parse(run.resultsJson) as EvalMetrics) : null}
      ranAt={run ? run.createdAt.toISOString() : null}
    />
  )
}
