import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * The most important component on the screen.
 */
export function SpendMeter({
  authorizedPaise,
  totalCapPaise,
  revoked = false,
}: {
  authorizedPaise: number
  totalCapPaise: number
  revoked?: boolean
}) {
  const pct = Math.min(100, (authorizedPaise / totalCapPaise) * 100)

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-2xl tabular-nums tracking-tight">
          {formatINR(authorizedPaise)}
          <span className="text-muted-foreground text-base"> / {formatINR(totalCapPaise)}</span>
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {revoked ? 'revoked' : `${formatINR(Math.max(0, totalCapPaise - authorizedPaise))} remaining`}
        </div>
      </div>

      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full transition-[width] duration-300 ease-out',
            revoked ? 'bg-muted-foreground' : 'bg-emerald-600',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
