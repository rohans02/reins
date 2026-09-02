import { Badge } from '@/components/ui/badge'
import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * One card per verdict.
 *
 * A 3px left border carries the entire semantic colour system: green = ALLOW,
 * red = BLOCK, amber = ESCALATE. Nothing else in the app is coloured, so when a
 * block lands it is the only red thing on screen — maximum impact, zero effort.
 */
export interface DecisionView {
  seq: number
  verdict: string
  reasonCodes: string[]
  itemId: string
  amountPaise: number
  latencyMs: number
  razorpayOrderId?: string | null
  explanation?: string | null
}

export function DecisionCard({ decision }: { decision: DecisionView }) {
  const blocked = decision.verdict === 'BLOCK'
  const escalated = decision.verdict === 'ESCALATE'

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-3 border-l-[3px]',
        blocked && 'border-l-destructive',
        escalated && 'border-l-amber-500',
        !blocked && !escalated && 'border-l-emerald-600',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              'font-mono text-xs font-semibold',
              blocked ? 'text-destructive' : escalated ? 'text-amber-600' : 'text-emerald-600',
            )}
          >
            {decision.verdict}
          </span>
          <span className="font-mono text-sm truncate">{decision.itemId}</span>
        </div>
        <span className="font-mono text-sm tabular-nums shrink-0">
          {formatINR(decision.amountPaise)}
        </span>
      </div>

      {decision.reasonCodes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {decision.reasonCodes.map((code) => (
            <Badge key={code} variant="destructive" className="font-mono text-[10px] font-normal">
              {code}
            </Badge>
          ))}
        </div>
      )}

      {decision.explanation && (
        <p className="mt-2 text-xs text-muted-foreground">{decision.explanation}</p>
      )}

      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
        <span>#{decision.seq}</span>
        <span>{decision.latencyMs.toFixed(2)}ms</span>
        {decision.razorpayOrderId && <span className="truncate">{decision.razorpayOrderId}</span>}
      </div>
    </div>
  )
}
