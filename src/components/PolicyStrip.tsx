import type { CheckResult } from '@/lib/policy/engine'
import { cn } from '@/lib/utils'

/**
 * The policy engine pipeline, rendered.
 *
 * This is the component that makes the thesis visible without a slide: the LLM
 * proposed, and nine deterministic checks decided. Every check that ran is shown
 * — green for passed, red for failed — so a judge sees the *whole* pipeline, not
 * just the failures.
 *
 * The engine does not short-circuit, which is what makes this land: the Luxe
 * watch lights four cells red simultaneously while five stay green. One attempt,
 * four rules broken, all visible at once.
 */

/** Shown greyed before the first decision, so the pipeline is legible at rest. */
const IDLE_CHECKS: Array<Pick<CheckResult, 'id' | 'label'>> = [
  { id: 'signature', label: 'Signature' },
  { id: 'replay', label: 'Replay' },
  { id: 'status', label: 'Status' },
  { id: 'expiry', label: 'Expiry' },
  { id: 'merchant', label: 'Merchant' },
  { id: 'category', label: 'Category' },
  { id: 'perTxnCap', label: 'Per-txn cap' },
  { id: 'totalCap', label: 'Total cap' },
  { id: 'velocity', label: 'Velocity' },
]

export function PolicyStrip({
  checks,
  latencyMs,
}: {
  checks: CheckResult[] | null
  latencyMs: number | null
}) {
  const cells = checks ?? IDLE_CHECKS.map((c) => ({ ...c, passed: null as boolean | null }))

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-baseline justify-between mb-2.5">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Policy engine
        </h2>
        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {latencyMs === null ? 'deterministic · no model' : `decided in ${(latencyMs * 1000).toFixed(0)}µs`}
        </span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-1.5">
        {cells.map((c) => {
          const passed = (c as CheckResult).passed as boolean | null
          return (
            <div
              key={c.id}
              className={cn(
                'rounded-md border px-2 py-1.5 transition-colors duration-200',
                passed === null && 'border-border bg-muted/30',
                passed === true && 'border-emerald-600/30 bg-emerald-600/10',
                passed === false && 'border-destructive/40 bg-destructive/15',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn(
                    'inline-block size-1.5 rounded-full shrink-0',
                    passed === null && 'bg-muted-foreground/40',
                    passed === true && 'bg-emerald-600',
                    passed === false && 'bg-destructive',
                  )}
                />
                <span
                  className={cn(
                    'font-mono text-[10px] leading-tight truncate',
                    passed === null && 'text-muted-foreground',
                    passed === true && 'text-emerald-700 dark:text-emerald-500',
                    passed === false && 'text-destructive font-semibold',
                  )}
                >
                  {c.label}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
