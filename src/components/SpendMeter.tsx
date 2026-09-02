import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * The most important component on the screen.
 *
 * It shows AUTHORIZED spend against the cap — the number the policy engine
 * actually enforces — not settled spend, which lags behind the webhook. The bar
 * filling toward a hard wall is the whole product in one object.
 *
 * Tabular numerals so the digits do not jitter as the total climbs.
 */
export function SpendMeter({
  authorizedPaise,
  totalCapPaise,
  segments = [],
  revoked = false,
}: {
  authorizedPaise: number
  totalCapPaise: number
  segments?: number[]
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
        {/* Per-purchase ticks, so several small buys still read as several. */}
        {segments.length > 1 &&
          segments.slice(0, -1).map((cumulative, i) => (
            <div
              key={i}
              className="absolute top-0 h-full w-px bg-background/70"
              style={{ left: `${Math.min(100, (cumulative / totalCapPaise) * 100)}%` }}
            />
          ))}
      </div>
    </div>
  )
}
