import { cn } from '@/lib/utils'

/**
 * Stat tile contract (per the dataviz guidance): sentence-case label with no
 * trailing colon, semibold sans value, optional status.
 */
export function KpiTile({
  label,
  value,
  status,
  note,
  hero = false,
}: {
  label: string
  value: string
  status?: 'pass' | 'fail' | 'neutral'
  note?: string
  hero?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-card p-4',
        hero && 'sm:col-span-2 sm:row-span-2 flex flex-col justify-center',
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>

      <div
        className={cn(
          'mt-1 font-semibold tracking-tight',
          hero ? 'text-5xl' : 'text-2xl',
          status === 'fail' && 'text-destructive',
        )}
      >
        {value}
      </div>

      {status && status !== 'neutral' && (
        <div className="mt-2 flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              'inline-block size-1.5 rounded-full',
              status === 'pass' ? 'bg-emerald-600' : 'bg-destructive',
            )}
          />
          <span
            className={cn(
              'font-mono text-[10px] font-medium uppercase tracking-wide',
              status === 'pass' ? 'text-emerald-600' : 'text-destructive',
            )}
          >
            {status === 'pass' ? 'pass' : 'fail'}
          </span>
        </div>
      )}

      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
    </div>
  )
}
