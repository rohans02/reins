'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { KpiTile } from '@/components/KpiTile'
import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { EvalMetrics } from '@/lib/eval/runner'

/**
 * Trust Report — the metrics competitors will not have.
 *
 * Deliberately not a chart. Per the form heuristic, a headline number's job is to
 * be read, not compared over time — so this is one hero figure plus stat tiles
 * plus a table, and the page ships zero chart libraries.
 *
 * The hero figure is unauthorized spend. It is shown even at zero — especially at
 * zero, because zero is the claim.
 */
export function TrustReport({
  initialMetrics,
  ranAt,
}: {
  initialMetrics: EvalMetrics | null
  ranAt: string | null
}) {
  const [metrics, setMetrics] = useState<EvalMetrics | null>(initialMetrics)
  const [when, setWhen] = useState<string | null>(ranAt)
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    try {
      const res = await fetch('/api/eval/run', { method: 'POST' })
      const body = (await res.json()) as { metrics: EvalMetrics }
      setMetrics(body.metrics)
      setWhen(new Date().toISOString())
    } finally {
      setRunning(false)
    }
  }

  const clean = metrics ? metrics.unauthorizedPaise === 0 && metrics.failed === 0 : false

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Trust Report</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every case runs through the real policy engine. It is a pure function, so these
            numbers are reproducible byte-for-byte on any machine.
          </p>
        </div>
        <Button onClick={run} disabled={running} className="shrink-0">
          {running ? 'Running…' : 'Run adversarial suite'}
        </Button>
      </header>

      {!metrics ? (
        <p className="text-sm text-muted-foreground">
          No run yet. Run the suite to measure what the engine actually refuses.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiTile
              hero
              label="Unauthorized spend"
              value={formatINR(metrics.unauthorizedPaise)}
              status={metrics.unauthorizedPaise === 0 ? 'pass' : 'fail'}
              note="Money that would have moved on a case the engine should have refused."
            />
            <KpiTile
              label="Refused correctly"
              value={`${metrics.blockedCorrectly}/${metrics.blockCases}`}
              status={metrics.blockedCorrectly === metrics.blockCases ? 'pass' : 'fail'}
            />
            <KpiTile
              label="Allowed correctly"
              value={`${metrics.allowedCorrectly}/${metrics.allowCases}`}
              status={metrics.allowedCorrectly === metrics.allowCases ? 'pass' : 'fail'}
              note="Legitimate purchases. A suite of only blocks proves nothing."
            />
            <KpiTile
              label="Authorization p50"
              value={`${(metrics.p50LatencyMs * 1000).toFixed(0)}µs`}
              note={`p99 ${(metrics.p99LatencyMs * 1000).toFixed(0)}µs`}
            />
            <KpiTile
              label="Ledger chain"
              value={metrics.chainVerified ? 'Verified' : 'Broken'}
              status={metrics.chainVerified ? 'pass' : 'fail'}
            />
          </div>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-medium">By category</h2>
              <span className="text-xs text-muted-foreground">
                {when && `last run ${new Date(when).toLocaleString()}`}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Reported per category rather than as one aggregate. An aggregate hides which rule
              is weak.
            </p>

            <div className="rounded-lg border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="w-24 text-right">Cases</TableHead>
                    <TableHead className="w-24 text-right">Passed</TableHead>
                    <TableHead className="w-20 text-right">Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.byCategory.map((c) => (
                    <TableRow key={c.category}>
                      <TableCell className="font-mono text-xs">{c.category}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {c.total}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {c.passed}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-mono text-xs tabular-nums',
                          c.passed < c.total && 'text-destructive',
                        )}
                      >
                        {Math.round((c.passed / c.total) * 100)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          {metrics.failed > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium text-destructive">Failures</h2>
              {metrics.results
                .filter((r) => !r.passed)
                .map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-border border-l-[3px] border-l-destructive bg-card p-3 text-xs"
                  >
                    <div className="font-mono">{r.id}</div>
                    <div className="text-muted-foreground mt-1">{r.description}</div>
                    <div className="font-mono mt-1">
                      expected {r.expectedVerdict} [{r.expectedReasonCodes.join(', ')}] · actual{' '}
                      {r.actualVerdict} [{r.actualReasonCodes.join(', ')}]
                    </div>
                  </div>
                ))}
            </section>
          )}

          <section className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-medium">Limitations</h2>
              <Badge variant="secondary" className="text-[10px]">stated, not asked for</Badge>
            </div>
            <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
              <li>
                These cases are self-authored. They are published in{' '}
                <code className="font-mono">src/lib/eval/cases.ts</code> and reproducible with{' '}
                <code className="font-mono">npm run eval</code>, and results are reported per
                category so a weak rule cannot hide inside a good average.
              </li>
              <li>
                Latency is measured on a pure in-process function. It excludes network, database
                and Razorpay time, and is not an end-to-end figure.
              </li>
              <li>
                The suite exercises the policy engine. It does not test whether the model behaves
                sensibly — that needs a live model and is tracked separately.
              </li>
              <li>
                Payment authorization is partly simulated. Orders are real; bulk capture is a
                signed synthetic webhook through the real verification path.
              </li>
            </ul>
          </section>

          {clean && (
            <p className="text-xs text-muted-foreground">
              {metrics.totalCases} cases · {metrics.passed} passed · zero unauthorized paise.
            </p>
          )}
        </>
      )}
    </div>
  )
}
