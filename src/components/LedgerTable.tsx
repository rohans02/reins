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
import { cn } from '@/lib/utils'

/**
 * Audit Ledger — proves nothing was hidden and nothing was altered.
 *
 * No AI and no Razorpay on this screen, deliberately. It exists to be checkable,
 * so nothing on it may be probabilistic. The "chain verified" badge is computed
 * by recomputing every hash on request, not stored and trusted.
 */

export interface LedgerRow {
  seq: number
  createdAt: string
  action: string
  verdict: string
  reasonCodes: string[]
  explanation: string | null
  requestedAction: { itemId?: string; amountPaise?: number; merchantId?: string }
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
  const visible = rows.filter((r) => filter === 'ALL' || r.verdict === filter)

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
