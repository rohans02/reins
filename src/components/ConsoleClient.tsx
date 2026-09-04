'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MandatePanel, type MandateView } from '@/components/MandatePanel'
import { ActivityFeed, type FeedRow, type PlannedItem } from '@/components/ActivityFeed'
import type { ClaimedFields } from '@/lib/claimed'
import { LedgerSlideOver } from '@/components/LedgerSlideOver'
import { MandateSwitcher, type SwitchableMandate } from '@/components/MandateSwitcher'

/**
 * ★ MISSION CONTROL — roughly 70% of the five-minute demo happens on this screen.
 *
 * Two panels:
 *   left    the mandate — bounds, spend meter, expiry countdown, REVOKE
 *   right   one merged activity feed, with the command bar anchored below it
 *
 * The audit ledger is a slide-over rather than a third column: it is not needed
 * until after the revoke, and a third panel would compete for attention during
 * the block, which is the moment the whole demo turns on.
 *
 * No navigation is required at any point in the demo.
 */
export function ConsoleClient({
  mandate,
  initialRows,
  switchable,
  initialMode,
}: {
  mandate: MandateView | null
  /** Verdict history rebuilt from the ledger, so a reload keeps the evidence. */
  initialRows: FeedRow[]
  /** Every mandate the console can be pointed at, for the header switcher. */
  switchable: SwitchableMandate[]
  /** The mode the server would use right now, so the header is never blank. */
  initialMode: { scripted: boolean; label: string }
}) {
  const router = useRouter()

  const [running, setRunning] = useState(false)
  const [task, setTask] = useState('Restock my pantry for the week.')
  const [liveRows, setLiveRows] = useState<FeedRow[]>([])
  // Seeded from the server so the header states the mode on arrival, then
  // corrected by the run's own mode event. A judge should never have to wonder
  // whether they are watching a live model or a recording.
  const [scripted, setScripted] = useState(initialMode.scripted)
  const [modeLabel, setModeLabel] = useState<string>(initialMode.label)
  const [forceAttempt, setForceAttempt] = useState(false)
  // Optimistic spend during a run; the server value catches up on refresh.
  const [delta, setDelta] = useState(0)

  async function runAgent() {
    if (!mandate) return
    setRunning(true)
    setLiveRows([])
    setDelta(0)

    try {
      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mandateId: mandate.id, task, forceAttempt }),
      })
      if (!res.body) throw new Error('no stream')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE frames are separated by a blank line; keep any partial tail.
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
          if (!frame.startsWith('data: ')) continue
          handleEvent(JSON.parse(frame.slice(6)) as Record<string, unknown>)
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Agent run failed')
    } finally {
      setRunning(false)
      setDelta(0)
      router.refresh()
    }
  }

  function handleEvent(ev: Record<string, unknown>) {
    const id = `${String(ev.type)}-${Math.random().toString(36).slice(2, 9)}`

    switch (ev.type) {
      case 'mode':
        setScripted(Boolean(ev.scripted))
        setModeLabel(
          ev.scripted
            ? 'scripted'
            : ev.forceAttempt
              ? 'live · compromised agent'
              : `live · ${String(ev.modelName ?? 'model')}`,
        )
        break

      case 'text':
        setLiveRows((r) => [...r, { kind: 'say', id, text: String(ev.text) }])
        break

      case 'plan':
        setLiveRows((r) => [
          ...r,
          {
            kind: 'plan',
            id,
            summary: String(ev.summary ?? ''),
            items: (ev.items ?? []) as PlannedItem[],
          },
        ])
        break

      case 'tool_call':
        // request_purchase is represented by its verdict row instead — showing
        // both would say the same thing twice, right where attention matters.
        if (ev.name === 'request_purchase') break
        setLiveRows((r) => [
          ...r,
          { kind: 'tool', id, name: String(ev.name), input: ev.input as Record<string, unknown> },
        ])
        break

      case 'decision': {
        const amountPaise = Number(ev.amountPaise)
        const verdict = String(ev.verdict)
        setLiveRows((r) => [
          ...r,
          {
            kind: 'verdict',
            id,
            seq: Number(ev.seq),
            verdict,
            reasonCodes: ev.reasonCodes as string[],
            merchantId: String(ev.merchantId),
            itemId: String(ev.itemId),
            amountPaise,
            // Resolved category and the agent's claim, so a relabelling attempt
            // shows its evidence line live and not only after a reload.
            category: typeof ev.category === 'string' ? ev.category : undefined,
            claimed: (ev.claimed as ClaimedFields | undefined) ?? null,

            explanation: typeof ev.explanation === 'string' ? ev.explanation : null,
            latencyUs: Math.round(Number(ev.latencyMs) * 1000),
          },
        ])

        if (verdict === 'ALLOW') {
          setDelta((x) => x + amountPaise)
        }
        break
      }

      case 'purchase':
        setLiveRows((r) => {
          const next = [...r]
          for (let i = next.length - 1; i >= 0; i--) {
            const row = next[i]
            if (row.kind === 'verdict' && !row.razorpayOrderId) {
              next[i] = {
                ...row,
                razorpayOrderId: String(ev.razorpayOrderId),
                paymentLinkUrl: typeof ev.paymentLinkUrl === 'string' ? ev.paymentLinkUrl : null,
              }
              break
            }
          }
          return next
        })
        break

      case 'error':
        setLiveRows((r) => [
          ...r,
          { kind: 'system', id, text: `error: ${String(ev.message)}`, tone: 'bad' },
        ])
        break

      case 'done':
        setLiveRows((r) => [
          ...r,
          {
            kind: 'system',
            id,
            text: `run ${String(ev.reason)} — ${String(ev.purchases)} authorized, ${String(ev.blocked)} refused`,
          },
        ])
        break
    }
  }

  // Settled spend arrives by WEBHOOK, so nothing in this browser knows when it
  // lands. Paying a link is a conversation between the payer and Razorpay, and
  // the confirmation reaches the server minutes or seconds later with no request
  // from here to hang a response on.
  //
  // So the console asks again, but only while there is something outstanding:
  // authorized money that has not settled yet. Once the two agree, or the run is
  // in flight and refreshing anyway, the polling stops. That keeps a demo screen
  // truthful without leaving a timer running all night on an idle laptop.
  const settlementPending = Boolean(
    mandate && mandate.settledPaise < mandate.authorizedPaise && !running,
  )

  useEffect(() => {
    if (!settlementPending) return
    const id = setInterval(() => router.refresh(), 4000)
    return () => clearInterval(id)
  }, [settlementPending, router])

  const liveSeqs = new Set(
    liveRows.flatMap((r) => (r.kind === 'verdict' ? [r.seq] : [])),
  )
  const rows: FeedRow[] = [
    ...initialRows.filter((r) => r.kind !== 'verdict' || !liveSeqs.has(r.seq)),
    ...liveRows,
  ]

  async function revoke() {
    if (!mandate) return
    await fetch(`/api/mandates/${mandate.id}/revoke`, { method: 'POST' })
    toast.error('Mandate revoked. The agent can spend nothing further.')
    router.refresh()
  }

  if (!mandate) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">No active mandate</h1>
          <p className="text-muted-foreground">
            An agent with no mandate can spend nothing. Give it bounded authority to begin.
          </p>
          <Button render={<Link href="/mandates/new" />} nativeButton={false} className="h-9">
            Create a mandate
          </Button>
        </div>
      </div>
    )
  }

  const revoked = mandate.status === 'REVOKED'

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-border">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">Mission Control</h1>
          <p className="text-[11px] text-muted-foreground">
            The agent proposes. The policy engine decides.
          </p>
        </div>
        <div className="flex-1" />
        <span className="shrink-0 rounded-md bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {modeLabel}
        </span>
        <MandateSwitcher current={mandate.id} options={switchable} />
        <LedgerSlideOver />
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[340px_1fr]">
        <div className="border-r border-border min-h-0">
          <MandatePanel
            mandate={mandate}
            delta={delta}
            onRevoke={revoke}
          />
        </div>

        <div className="min-h-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <ActivityFeed rows={rows} />
          </div>

          {/* Command bar, anchored to the bottom where the feed ends. */}
          <div className="border-t border-border px-4 py-3 space-y-2">
            <div className="flex items-center gap-2">
              <Input
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !running && !revoked) void runAgent()
                }}
                placeholder="What should the agent do?"
                disabled={running || revoked}
                className="h-10"
              />
              <Button
                onClick={runAgent}
                disabled={running || revoked}
                className="h-10 shrink-0 px-5"
              >
                {running ? 'Running…' : 'Run agent'}
              </Button>
              {running && (
                <span className="flex items-center gap-1.5 shrink-0 pl-1">
                  <span className="inline-block size-1.5 rounded-full bg-emerald-600 animate-pulse" />
                  <span className="font-mono text-[11px] text-muted-foreground">live</span>
                </span>
              )}
            </div>

            {/* Hidden in scripted mode, where the recorded run already contains
                the out-of-bounds attempt and the toggle would do nothing. */}
            {!scripted && (
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={forceAttempt}
                  onChange={(e) => setForceAttempt(e.target.checked)}
                  disabled={running || revoked}
                  className="size-3.5 accent-destructive"
                />
                Simulate a compromised agent
              </label>
            )}

            {scripted && (
              <p className="text-[11px] text-muted-foreground">
                This run uses a scripted agent, so its choices are fixed. The policy engine, the ledger
                and the Razorpay orders are all real.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
