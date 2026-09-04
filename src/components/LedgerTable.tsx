'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatINR } from '@/lib/money'
import { claimedLine, type ClaimedFields } from '@/lib/claimed'
import { cn } from '@/lib/utils'

/**
 * Audit Ledger — proves nothing was hidden and nothing was altered.
 */

export interface LedgerRow {
  seq: number
  mandateId: string
  /** Short human label for the mandate, for the filter and the row. */
  mandateLabel: string
  createdAt: string
  action: string
  verdict: string
  reasonCodes: string[]
  explanation: string | null
  requestedAction: {
    itemId?: string
    amountPaise?: number
    merchantId?: string
    category?: string
    /** What the agent said it was buying, kept as evidence and never judged. */
    claimed?: ClaimedFields | null
  }
  latencyUs: number
  hash: string
  razorpayOrderId: string | null
}

type Filter = 'ALL' | 'ALLOW' | 'BLOCK'

export interface ChainStatus {
  verified: boolean
  entriesChecked: number
  brokenAtSeq: number | null
}

export function LedgerTable({ rows, chain }: { rows: LedgerRow[]; chain: ChainStatus }) {
  const router = useRouter()
  const [filter, setFilter] = useState<Filter>('ALL')
  // One chain across every mandate. A per-mandate chain could omit a decision
  // and still verify, so mandate is a filter here and never a separate sequence.
  const [mandateId, setMandateId] = useState<string>('ALL')

  const mandates = [...new Map(rows.map((r) => [r.mandateId, r.mandateLabel])).entries()]

  const visible = rows.filter(
    (r) =>
      (filter === 'ALL' || r.verdict === filter) &&
      (mandateId === 'ALL' || r.mandateId === mandateId),
  )

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit Ledger</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed max-w-2xl">
            Append-only and hash-chained. Every decision is here. The refusals matter as much as the
            approvals.
          </p>
        </div>
        <Badge
            variant={chain.verified ? 'secondary' : 'destructive'}
            className="font-mono text-xs shrink-0"
          >
            {chain.verified
              ? `chain verified · ${chain.entriesChecked} entries`
              : `CHAIN BROKEN at #${chain.brokenAtSeq}`}
        </Badge>
      </header>

      <div className="flex items-center gap-2">
        {(['ALL', 'ALLOW', 'BLOCK'] as const).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'secondary' : 'ghost'}
            onClick={() => setFilter(f)}
            className="font-mono text-xs"
          >
            {f}
          </Button>
        ))}
        {mandates.length > 1 && (
          <>
            <span className="ml-2 text-xs text-muted-foreground">Mandate</span>
            <select
              value={mandateId}
              onChange={(e) => setMandateId(e.target.value)}
              aria-label="Filter by mandate"
              className="max-w-[16rem] truncate rounded-md border border-border bg-background px-2 py-1 text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="ALL">All mandates</option>
              {mandates.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => router.refresh()} className="ml-auto text-xs">
          Refresh
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing recorded yet. Run the agent and every verdict will appear here.
        </p>
      ) : (
        // `table-fixed` so the Detail column absorbs the slack and every other
        // column keeps its width. Reason codes then wrap inside the cell rather
        // than stretching one row until the Amount column slides off screen.
        <div className="rounded-lg border border-border">
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead className="w-24">Time</TableHead>
                {mandates.length > 1 && <TableHead className="w-32">Mandate</TableHead>}
                <TableHead className="w-20">Verdict</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead className="w-28 text-right">Amount</TableHead>
                <TableHead className="w-20 text-right">Latency</TableHead>
                <TableHead className="w-20">Hash</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={r.seq} className="align-top">
                  <TableCell className="font-mono text-xs tabular-nums">{r.seq}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleTimeString()}
                  </TableCell>
                  {mandates.length > 1 && (
                    <TableCell
                      className="font-mono text-xs text-muted-foreground truncate"
                      title={r.mandateLabel}
                    >
                      {r.mandateLabel}
                    </TableCell>
                  )}
                  <TableCell>
                    <span
                      className={cn(
                        'font-mono text-xs font-semibold',
                        r.verdict === 'BLOCK' ? 'text-destructive' : 'text-emerald-600',
                      )}
                    >
                      {r.verdict}
                    </span>
                  </TableCell>

                  <TableCell className="text-xs">
                    <div className="font-mono truncate">
                      {r.requestedAction.itemId ?? r.action.toLowerCase().replaceAll('_', ' ')}
                    </div>

                    {r.reasonCodes.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {r.reasonCodes.map((code) => (
                          <span
                            key={code}
                            className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] leading-tight text-destructive"
                          >
                            {code}
                          </span>
                        ))}
                      </div>
                    )}

                    {r.explanation && (
                      <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                        {r.explanation}
                      </div>
                    )}

                    {claimedLine(r.requestedAction) && (
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                        {claimedLine(r.requestedAction)}
                      </div>
                    )}

                    {r.razorpayOrderId && (
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground truncate">
                        {r.razorpayOrderId}
                      </div>
                    )}
                  </TableCell>

                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {r.requestedAction.amountPaise ? formatINR(r.requestedAction.amountPaise) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {r.latencyUs}µs
                  </TableCell>
                  <TableCell className="font-mono text-[10px] text-muted-foreground truncate">
                    {r.hash.slice(0, 8)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
