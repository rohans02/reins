'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import { SpendMeter } from '@/components/SpendMeter'
import { DecisionCard, type DecisionView } from '@/components/DecisionCard'
import { AgentTranscript, type TranscriptLine } from '@/components/AgentTranscript'
import { formatINR } from '@/lib/money'

/**
 * ★ HERO SCREEN — roughly 70% of the five-minute demo happens here.
 *
 * Everything the demo needs is above the fold: the spend meter climbing toward a
 * hard wall, a permanently-visible REVOKE, the live decision feed with the red
 * card, and the agent's transcript. Deliberately no navigation during a run.
 */

interface MandateView {
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

export function ConsoleClient({ mandate }: { mandate: MandateView | null }) {
  const router = useRouter()
  // Optimistic spend applied during a run; the server value catches up on refresh.
  const [delta, setDelta] = useState(0)
  const [running, setRunning] = useState(false)
  const [task, setTask] = useState('Restock my pantry for the week.')
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [decisions, setDecisions] = useState<DecisionView[]>([])
  const [scripted, setScripted] = useState(false)

  async function runAgent() {
    if (!mandate) return
    setRunning(true)
    setLines([])
    setDecisions([])
    setDelta(0)

    try {
      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mandateId: mandate.id, task }),
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
    switch (ev.type) {
      case 'mode':
        setScripted(Boolean(ev.scripted))
        break
      case 'text':
        setLines((l) => [...l, { kind: 'text', text: String(ev.text) }])
        break
      case 'tool_call':
        setLines((l) => [
          ...l,
          { kind: 'tool', name: String(ev.name), input: ev.input as Record<string, unknown> },
        ])
        break
      case 'decision': {
        const view: DecisionView = {
          seq: Number(ev.seq),
          verdict: String(ev.verdict),
          reasonCodes: ev.reasonCodes as string[],
          itemId: String(ev.itemId),
          amountPaise: Number(ev.amountPaise),
          latencyMs: Number(ev.latencyMs),
        }
        setDecisions((d) => [view, ...d])
        if (view.verdict === 'ALLOW') setDelta((x) => x + view.amountPaise)
        break
      }
      case 'purchase':
        setDecisions((d) =>
          d.map((x, i) => (i === 0 ? { ...x, razorpayOrderId: String(ev.razorpayOrderId) } : x)),
        )
        break
      case 'error':
        setLines((l) => [...l, { kind: 'system', text: `error: ${String(ev.message)}` }])
        break
      case 'done':
        setLines((l) => [
          ...l,
          {
            kind: 'system',
            text: `run ${String(ev.reason)} — ${String(ev.purchases)} purchased, ${String(ev.blocked)} blocked`,
          },
        ])
        break
    }
  }

  async function revoke() {
    if (!mandate) return
    await fetch(`/api/mandates/${mandate.id}/revoke`, { method: 'POST' })
    toast.success('Mandate revoked. The agent can spend nothing further.')
    router.refresh()
  }

  if (!mandate) {
    return (
      <div className="p-8 max-w-lg">
        <h1 className="text-lg font-semibold">No active mandate</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An agent with no mandate can spend nothing. Create one to give it bounded authority.
        </p>
        <Button render={<Link href="/mandates/new" />} className="mt-4">
          Create a mandate
        </Button>
      </div>
    )
  }

  const revoked = mandate.status === 'REVOKED'
  const cumulative = [...decisions]
    .filter((d) => d.verdict === 'ALLOW')
    .reverse()
    .reduce<number[]>((acc, d) => [...acc, (acc.at(-1) ?? 0) + d.amountPaise], [])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      {/* Mandate header strip — spend meter, bounds, and the kill switch. */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1 min-w-0">
            <SpendMeter
              authorizedPaise={mandate.authorizedPaise + delta}
              totalCapPaise={mandate.totalCapPaise}
              segments={cumulative}
              revoked={revoked}
            />
          </div>

          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" disabled={revoked} className="shrink-0" />}
            >
              {revoked ? 'Revoked' : 'Revoke'}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Revoke this mandate?</AlertDialogTitle>
                <AlertDialogDescription>
                  The agent&apos;s next action is refused immediately. Nothing is queued and there is
                  no grace period. Purchases already authorized are unaffected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={revoke}>Revoke</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground font-mono border-t border-border pt-3">
          <span>{mandate.rules.merchants.join(' · ')}</span>
          <span>{mandate.rules.categories.join(' · ')}</span>
          <span>{formatINR(mandate.rules.perTxnCapPaise)}/txn</span>
          <span>{mandate.rules.maxTxnsPerHour}/hr</span>
          <span>settled {formatINR(mandate.settledPaise)}</span>
          {revoked && <Badge variant="destructive">REVOKED</Badge>}
        </div>
      </div>

      {/* Task + run */}
      <div className="flex gap-2">
        <Input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder="What should the agent do?"
          disabled={running || revoked}
        />
        <Button onClick={runAgent} disabled={running || revoked}>
          {running ? 'Running…' : 'Run agent'}
        </Button>
      </div>

      {scripted && (
        <p className="text-xs text-muted-foreground">
          Scripted model: the agent&apos;s choices are fixed, but the policy engine, ledger and
          Razorpay orders are real.
        </p>
      )}

      {/* Transcript | decisions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
            Agent
          </h2>
          <AgentTranscript lines={lines} />
        </section>

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Decisions
          </h2>
          {decisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every purchase attempt lands here — allowed and blocked alike.
            </p>
          ) : (
            decisions.map((d) => <DecisionCard key={d.seq} decision={d} />)
          )}
        </section>
      </div>
    </div>
  )
}
