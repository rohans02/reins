'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Ban, ExternalLink, Plus } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Mandates — every piece of spending authority that exists, in one list.
 *
 * This screen is what makes concurrent mandates safe to allow. Signing used to
 * revoke whatever came before, because the console could only ever show one and
 * an unseen ACTIVE mandate is spendable authority nobody is watching. The fix
 * for authority you cannot see is to show it, not to destroy it.
 *
 * So the loudest thing on the page is the combined figure: everything every
 * live mandate could still spend, added up. Any single mandate understates the
 * real exposure, and that total is the number a person needs before deciding
 * whether something should be revoked.
 */

export interface ManagedMandate {
  id: string
  status: string
  intentText: string
  merchants: string[]
  categories: string[]
  perTxnCapPaise: number
  maxTxnsPerHour: number
  totalCapPaise: number
  authorizedPaise: number
  remainingPaise: number
  purchaseCount: number
  signature: string
  expiresAt: string
  createdAt: string
  live: boolean
}

export function MandateManager({
  mandates,
  totalExposurePaise,
}: {
  mandates: ManagedMandate[]
  totalExposurePaise: number
}) {
  const router = useRouter()
  const [pending, setPending] = useState<ManagedMandate | null>(null)

  const live = mandates.filter((m) => m.live)
  const past = mandates.filter((m) => !m.live)

  async function revoke(m: ManagedMandate) {
    setPending(null)
    await fetch(`/api/mandates/${m.id}/revoke`, { method: 'POST' })
    toast.error('Mandate revoked. It can spend nothing further.')
    router.refresh()
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mandates</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-2xl">
            Every mandate you have ever signed. More than one can be live at a time, each on its
            own budget, and nothing here disappears once it stops being current.
          </p>
        </div>
        <Button render={<Link href="/mandates/new" />} nativeButton={false} className="h-9 shrink-0">
          <Plus className="size-4" />
          New mandate
        </Button>
      </header>

      {/* The headline number. One mandate never tells you the real exposure. */}
      <div className="rounded-lg border border-border bg-card p-5 flex flex-wrap items-baseline gap-x-8 gap-y-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Total live authority
          </div>
          <div className="font-mono text-2xl font-semibold tabular-nums mt-1">
            {formatINR(totalExposurePaise)}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Live now</div>
          <div className="font-mono text-2xl font-semibold tabular-nums mt-1">{live.length}</div>
        </div>
        <p className="text-xs text-muted-foreground max-w-sm leading-relaxed ml-auto">
          The most an agent could still spend right now, across every live mandate combined. It
          falls as authority is used and drops to nothing the moment you revoke.
        </p>
      </div>

      {mandates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No mandates yet. An agent with no mandate can spend nothing.
        </p>
      ) : (
        <>
          <Section title="Live" count={live.length}>
            {live.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing is live. No agent can spend a rupee until you sign a mandate.
              </p>
            ) : (
              live.map((m) => <MandateCard key={m.id} m={m} onRevoke={() => setPending(m)} />)
            )}
          </Section>

          {past.length > 0 && (
            <Section title="No longer live" count={past.length}>
              {past.map((m) => (
                <MandateCard key={m.id} m={m} onRevoke={() => setPending(m)} />
              ))}
            </Section>
          )}
        </>
      )}

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this mandate?</AlertDialogTitle>
            <AlertDialogDescription>
              It takes effect on the next action the agent attempts, including part-way through a
              run. Any other live mandate keeps its own budget and is left alone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <Button variant="destructive" onClick={() => pending && revoke(pending)}>
              Revoke
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{count}</span>
      </div>
      {children}
    </section>
  )
}

function MandateCard({ m, onRevoke }: { m: ManagedMandate; onRevoke: () => void }) {
  const pct = m.totalCapPaise > 0 ? Math.min(100, (m.authorizedPaise / m.totalCapPaise) * 100) : 0

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-5 space-y-4',
        m.live ? 'border-border' : 'border-border/60 opacity-75',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm leading-relaxed truncate">
            {m.intentText || <span className="text-muted-foreground">No description</span>}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground truncate">
            {m.id} · {m.signature.slice(0, 16)}
          </p>
        </div>
        <StatusChip status={m.status} live={m.live} />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3 font-mono text-xs tabular-nums">
          <span>
            {formatINR(m.authorizedPaise)}
            <span className="text-muted-foreground"> / {formatINR(m.totalCapPaise)}</span>
          </span>
          <span className={cn(m.live ? 'text-emerald-600' : 'text-muted-foreground')}>
            {formatINR(m.remainingPaise)} left
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full', m.live ? 'bg-emerald-600' : 'bg-muted-foreground')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2.5 border-t border-border pt-4">
        <Fact label="Merchants" value={m.merchants.join(', ')} />
        <Fact label="Categories" value={m.categories.join(', ')} />
        <Fact label="Per order" value={formatINR(m.perTxnCapPaise)} />
        <Fact label="Orders/hour" value={String(m.maxTxnsPerHour)} />
        <Fact label="Orders placed" value={String(m.purchaseCount)} />
        <Fact label="Expires" value={<Expiry iso={m.expiresAt} live={m.live} />} />
      </dl>

      <div className="flex gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          render={<Link href={`/console?mandate=${m.id}`} />}
          nativeButton={false}
        >
          <ExternalLink className="size-3.5" />
          Open in console
        </Button>
        {m.live && (
          <Button variant="ghost" size="sm" onClick={onRevoke} className="text-destructive">
            <Ban className="size-3.5" />
            Revoke
          </Button>
        )}
      </div>
    </div>
  )
}

function StatusChip({ status, live }: { status: string; live: boolean }) {
  // ACTIVE but not live means expired or fully spent. Labelling that "active"
  // would claim something the engine does not, so the chip follows the engine.
  const label = live ? status : status === 'ACTIVE' ? 'SPENT OR EXPIRED' : status
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide',
        live && 'bg-emerald-600/15 text-emerald-600',
        !live && status === 'REVOKED' && 'bg-destructive/15 text-destructive',
        !live && status !== 'REVOKED' && 'bg-muted text-muted-foreground',
      )}
    >
      {label}
    </span>
  )
}

/**
 * Rendered on the client only. An expiry phrased relative to now is computed
 * once on the server and again at hydration, and the two never agree.
 */
function Expiry({ iso, live }: { iso: string; live: boolean }) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const id = setTimeout(() => setNow(Date.now()), 0)
    return () => clearTimeout(id)
  }, [])

  if (now === null) return <span className="text-muted-foreground">&mdash;</span>

  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return <span className="text-muted-foreground">expired</span>
  if (!live) return <span className="text-muted-foreground">unused</span>

  const hours = Math.floor(ms / 3_600_000)
  const days = Math.floor(hours / 24)
  if (days > 0) return <span>in {days}d</span>
  if (hours > 0) return <span>in {hours}h</span>
  return <span>in {Math.max(1, Math.floor(ms / 60_000))}m</span>
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs mt-0.5 truncate">{value}</dd>
    </div>
  )
}
