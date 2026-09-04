'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * The audit ledger, as a panel you pull open on stage.
 */

interface Row {
  seq: number
  createdAt: string
  action: string
  verdict: string
  reasonCodes: string[]
  requestedAction: { itemId?: string; merchantId?: string; amountPaise?: number }
  latencyUs: number
  hash: string
  razorpayOrderId: string | null
}

interface Chain {
  verified: boolean
  entriesChecked: number
  brokenAtSeq: number | null
}

export function LedgerSlideOver() {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [chain, setChain] = useState<Chain | null>(null)
  const [violationsOnly, setViolationsOnly] = useState(false)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/ledger')
      const body = (await res.json()) as { decisions: Row[]; chain: Chain }
      setRows(body.decisions)
      setChain(body.chain)
    } finally {
      setLoading(false)
    }
  }

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next) await load()
  }

  const visible = (rows ?? []).filter((r) => !violationsOnly || r.verdict === 'BLOCK')

  return (
    <>
      <Button variant="outline" size="sm" onClick={toggle}>
        Audit ledger
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            aria-label="Close ledger"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />

          <aside className="relative w-full max-w-3xl bg-background border-l border-border flex flex-col shadow-2xl rn-enter">
            <header className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
              <div>
                <h2 className="font-semibold tracking-tight">Audit ledger</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Append-only and hash-chained. Every decision, allowed and refused alike.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {chain && (
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 font-mono text-[10px] font-medium',
                      chain.verified
                        ? 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-500'
                        : 'bg-destructive/15 text-destructive',
                    )}
                  >
                    {chain.verified
                      ? `chain verified · ${chain.entriesChecked}`
                      : `CHAIN BROKEN at #${chain.brokenAtSeq}`}
                  </span>
                )}
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            </header>

            <div className="px-5 py-2.5 border-b border-border flex items-center gap-2">
              <Button
                size="sm"
                variant={violationsOnly ? 'destructive' : 'secondary'}
                onClick={() => setViolationsOnly((v) => !v)}
                className="font-mono text-xs"
              >
                Violations only
              </Button>
              <Button size="sm" variant="ghost" onClick={load} className="text-xs">
                Refresh
              </Button>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
                {visible.length} {violationsOnly ? 'refused' : 'entries'}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && !rows ? (
                <p className="p-5 text-sm text-muted-foreground">Loading…</p>
              ) : visible.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">
                  {violationsOnly ? 'No refusals recorded.' : 'Nothing recorded yet.'}
                </p>
              ) : (
                <table className="w-full text-left">
                  <thead className="sticky top-0 bg-background border-b border-border">
                    <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-5 py-2 font-medium w-12">#</th>
                      <th className="py-2 font-medium w-24">Time</th>
                      <th className="py-2 font-medium w-20">Verdict</th>
                      <th className="py-2 font-medium">Detail</th>
                      <th className="py-2 font-medium w-24 text-right">Amount</th>
                      <th className="px-5 py-2 font-medium w-20">Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr key={r.seq} className="border-b border-border/50 align-top">
                        <td className="px-5 py-2 font-mono text-xs tabular-nums">{r.seq}</td>
                        <td className="py-2 font-mono text-[11px] text-muted-foreground">
                          {new Date(r.createdAt).toLocaleTimeString()}
                        </td>
                        <td className="py-2">
                          <span
                            className={cn(
                              'font-mono text-xs font-semibold',
                              r.verdict === 'BLOCK' ? 'text-destructive' : 'text-emerald-600',
                            )}
                          >
                            {r.verdict}
                          </span>
                        </td>
                        <td className="py-2 text-xs">
                          <span className="font-mono">
                            {r.requestedAction.merchantId ?? r.action}
                          </span>
                          {r.requestedAction.itemId && (
                            <span className="font-mono text-muted-foreground">
                              {' '}
                              {r.requestedAction.itemId}
                            </span>
                          )}
                          {r.reasonCodes.length > 0 && (
                            <div className="font-mono text-[10px] text-destructive mt-0.5">
                              {r.reasonCodes.join(' · ')}
                            </div>
                          )}
                          {r.razorpayOrderId && (
                            <div className="font-mono text-[10px] text-muted-foreground mt-0.5">
                              {r.razorpayOrderId}
                            </div>
                          )}
                        </td>
                        <td className="py-2 text-right font-mono text-xs tabular-nums">
                          {r.requestedAction.amountPaise
                            ? formatINR(r.requestedAction.amountPaise)
                            : '—'}
                        </td>
                        <td className="px-5 py-2 font-mono text-[10px] text-muted-foreground">
                          {r.hash.slice(0, 8)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
