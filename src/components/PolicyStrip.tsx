import type { CheckResult } from '@/lib/policy/engine'
import { cn } from '@/lib/utils'

/**
 * The policy engine pipeline, rendered.
 *
 * This is what makes the thesis visible without a slide: the LLM proposed, and
 * nine deterministic checks decided. Every check is shown — green for passed,
 * red for failed — so a judge sees the WHOLE pipeline, not just the failures.
 *
 * The engine does not short-circuit, which is what makes it land: the Luxe watch
 * lights four cells red while five stay green. One attempt, four rules broken,
 * all visible at once.
 *
 * The cells are numbered because the order is real and fixed — it is the same
 * order the reason codes appear in the audit ledger, so the strip reads as a
 * pipeline rather than a row of indicator lights.
 */

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
  const failed = checks?.filter((c) => !c.passed).length ?? 0
  const blocked = failed > 0

  return (
    <div
      className={cn(
        'rounded-lg border bg-card px-4 py-3 transition-colors duration-200',
        blocked ? 'border-destructive/40' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
        <h2 className="text-xs font-semibold tracking-tight">Policy engine</h2>

        <span className="text-[11px] text-muted-foreground">
          9 deterministic checks · no model involved
        </span>

        <span className="flex-1" />

        {checks && (
          <span
            className={cn(
              'font-mono text-[11px] font-semibold',
              blocked ? 'text-destructive' : 'text-emerald-600',
            )}
          >
            {blocked ? `REFUSED — ${failed} of 9 failed` : 'ALLOWED — 9 of 9 passed'}
          </span>
        )}

        <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
          {latencyMs === null ? 'idle' : `${(latencyMs * 1000).toFixed(0)}µs`}
        </span>
      </div>

      <ol className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-1.5">
        {cells.map((c, i) => {
          const passed = (c as CheckResult).passed as boolean | null
          return (
            <li
              key={c.id}
              className={cn(
                'rounded-md border px-2 py-2 transition-colors duration-200',
                passed === null && 'border-border bg-muted/30',
                passed === true && 'border-emerald-600/40 bg-emerald-600/10',
                passed === false && 'border-destructive bg-destructive/15',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'font-mono text-[10px] tabular-nums',
                    passed === null && 'text-muted-foreground/50',
                    passed === true && 'text-emerald-700/60 dark:text-emerald-500/60',
                    passed === false && 'text-destructive/70',
                  )}
                >
                  {i + 1}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'font-mono text-xs leading-none',
                    passed === null && 'text-muted-foreground/40',
                    passed === true && 'text-emerald-600',
                    passed === false && 'text-destructive',
                  )}
                >
                  {passed === null ? '·' : passed ? '✓' : '✕'}
                </span>
              </div>

              <div
                className={cn(
                  'mt-1 text-[11px] leading-tight',
                  passed === null && 'text-muted-foreground',
                  passed === true && 'text-emerald-700 dark:text-emerald-500',
                  passed === false && 'text-destructive font-semibold',
                )}
              >
                {c.label}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
