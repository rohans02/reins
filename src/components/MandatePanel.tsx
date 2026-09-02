'use client'

import { useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { SpendMeter } from '@/components/SpendMeter'
import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * The left panel of Mission Control: what the agent is allowed to do, how much
 * of it is used up, and the button that ends it.
 *
 * Everything a judge needs to understand the bounds is here, and REVOKE never
 * leaves the screen. Its permanent presence is a product statement — you can
 * always take the authority back — not just a control.
 */

export interface MandateView {
  id: string
  status: string
  intentText: string
  rules: {
    merchants: string[]
    categories: string[]
    perTxnCapPaise: number
    totalCapPaise: number
    maxTxnsPerHour: number
    expiresAt: string
  }
  totalCapPaise: number
  authorizedPaise: number
  settledPaise: number
  expiresAt: string
}

export function MandatePanel({
  mandate,
  delta,
  segments,
  onRevoke,
}: {
  mandate: MandateView
  delta: number
  segments: number[]
  onRevoke: () => void
}) {
  const revoked = mandate.status === 'REVOKED'
  const authorized = mandate.authorizedPaise + delta

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-5 py-4 border-b border-border">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Mandate
          </h2>
          <StatusPill status={mandate.status} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
        <p className="text-sm leading-relaxed text-muted-foreground">
          &ldquo;{mandate.intentText}&rdquo;
        </p>

        <SpendMeter
          authorizedPaise={authorized}
          totalCapPaise={mandate.totalCapPaise}
          segments={segments}
          revoked={revoked}
        />

        <dl className="space-y-2.5 border-t border-border pt-4">
          <Row label="Merchants">
            <div className="flex flex-wrap gap-1 justify-end">
              {mandate.rules.merchants.map((m) => (
                <span
                  key={m}
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]"
                >
                  {m}
                </span>
              ))}
            </div>
          </Row>
          <Row label="Categories">
            <div className="flex flex-wrap gap-1 justify-end">
              {mandate.rules.categories.map((c) => (
                <span key={c} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                  {c}
                </span>
              ))}
            </div>
          </Row>
          <Row label="Per order">
            <span className="font-mono text-xs tabular-nums">
              {formatINR(mandate.rules.perTxnCapPaise)}
            </span>
          </Row>
          <Row label="Rate limit">
            <span className="font-mono text-xs tabular-nums">
              {mandate.rules.maxTxnsPerHour}/hr
            </span>
          </Row>
          <Row label="Settled">
            <span className="font-mono text-xs tabular-nums">
              {formatINR(mandate.settledPaise)}
            </span>
          </Row>
          <Row label="Expires">
            <Countdown iso={mandate.expiresAt} revoked={revoked} />
          </Row>
        </dl>
      </div>

      <div className="p-4 border-t border-border">
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="destructive" disabled={revoked} className="w-full h-9" />
            }
          >
            {revoked ? 'Revoked' : 'Revoke now'}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke this mandate?</AlertDialogTitle>
              <AlertDialogDescription>
                The agent&apos;s very next action is refused — including mid-run. Nothing is queued
                and there is no grace period. Purchases already authorized are unaffected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onRevoke}>Revoke</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-right min-w-0">{children}</dd>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const revoked = status === 'REVOKED'
  const active = status === 'ACTIVE'

  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide',
        active && 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-500',
        revoked && 'bg-destructive/15 text-destructive',
        !active && !revoked && 'bg-muted text-muted-foreground',
      )}
    >
      {status}
    </span>
  )
}

/** Live countdown. Ticks once a second — cheap, and it makes expiry feel real. */
function Countdown({ iso, revoked }: { iso: string; revoked: boolean }) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    // The first tick goes through a timeout rather than running inline: a
    // synchronous setState in an effect triggers a cascading render, which React
    // 19 lints as an error. A 0ms timeout still lands within the first frame.
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const interval = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(interval)
    }
  }, [])

  // Rendered blank on the server so the markup matches on hydration.
  if (now === null) return <span className="font-mono text-xs">—</span>

  const ms = new Date(iso).getTime() - now
  if (revoked) return <span className="font-mono text-xs text-muted-foreground">—</span>
  if (ms <= 0) return <span className="font-mono text-xs text-destructive">expired</span>

  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const soon = ms < 60 * 60 * 1000

  return (
    <span className={cn('font-mono text-xs tabular-nums', soon && 'text-amber-600')}>
      {h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`}
    </span>
  )
}
