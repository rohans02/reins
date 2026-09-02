'use client'

import { useEffect, useRef } from 'react'
import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * The single stream judges watch for five minutes.
 *
 * The agent's narration, its tool calls, and the engine's verdicts are ONE feed,
 * not two columns — splitting them makes the eye choose, and the eye should
 * never have to choose during the block.
 *
 * A BLOCK row is deliberately loud: larger, red, sustained. It is NOT a shake.
 * Shake reads as malfunction, and the whole argument is that a refusal is the
 * system working exactly as designed. The entrance is confident, not panicked.
 */

export type FeedRow =
  | { kind: 'say'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | {
      kind: 'verdict'
      id: string
      seq: number
      verdict: string
      reasonCodes: string[]
      merchantId: string
      itemId: string
      amountPaise: number
      latencyMs: number
      razorpayOrderId?: string
    }
  | { kind: 'system'; id: string; text: string; tone?: 'normal' | 'bad' }

const REASON_TEXT: Record<string, string> = {
  MERCHANT_NOT_ALLOWLISTED: 'off-allowlist merchant',
  CATEGORY_NOT_ALLOWED: 'category not permitted',
  PER_TXN_CAP_EXCEEDED: 'over the per-order cap',
  TOTAL_CAP_EXCEEDED: 'over the remaining total',
  VELOCITY_LIMIT_EXCEEDED: 'too many orders this hour',
  MANDATE_REVOKED: 'mandate revoked',
  MANDATE_EXPIRED: 'mandate expired',
  MANDATE_NOT_ACTIVE: 'mandate not active',
  SIGNATURE_INVALID: 'signature invalid',
  DUPLICATE_REQUEST: 'duplicate request',
}

function plainReason(codes: string[]): string {
  if (codes.length === 0) return 'within mandate'
  return codes.map((c) => REASON_TEXT[c] ?? c.toLowerCase()).join(' · ')
}

export function ActivityFeed({ rows, running }: { rows: FeedRow[]; running: boolean }) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [rows.length])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Agent activity
        </h2>
        {running && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-1.5 rounded-full bg-emerald-600 animate-pulse" />
            <span className="font-mono text-[11px] text-muted-foreground">running</span>
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Give the agent a task — every attempt it makes, allowed or refused, lands
            here.
          </p>
        ) : (
          rows.map((row) => <Row key={row.id} row={row} />)
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}

function Row({ row }: { row: FeedRow }) {
  if (row.kind === 'say') {
    return <p className="text-sm leading-relaxed mg-enter">{row.text}</p>
  }

  if (row.kind === 'tool') {
    return (
      <div className="font-mono text-[11px] text-muted-foreground break-all mg-enter">
        <span className="text-foreground/70">▸ {row.name}</span>
        {`(${JSON.stringify(row.input)})`}
      </div>
    )
  }

  if (row.kind === 'system') {
    return (
      <div
        className={cn(
          'font-mono text-[11px] mg-enter',
          row.tone === 'bad' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {row.text}
      </div>
    )
  }

  const blocked = row.verdict === 'BLOCK'

  return (
    <div
      className={cn(
        'rounded-lg border bg-card',
        blocked
          ? 'mg-block-enter border-destructive/50 border-l-[4px] border-l-destructive p-4 shadow-sm'
          : 'mg-enter border-border border-l-[3px] border-l-emerald-600 p-3',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className={cn(
              'font-mono shrink-0',
              blocked ? 'text-destructive text-base' : 'text-emerald-600 text-sm',
            )}
          >
            {blocked ? '✕' : '✓'}
          </span>
          <span
            className={cn(
              'font-mono truncate',
              blocked ? 'text-base font-semibold' : 'text-sm',
            )}
          >
            {row.merchantId}
          </span>
          <span className="font-mono text-xs text-muted-foreground truncate">{row.itemId}</span>
        </div>

        <span
          className={cn(
            'font-mono tabular-nums shrink-0',
            blocked ? 'text-base font-semibold text-destructive' : 'text-sm',
          )}
        >
          {formatINR(row.amountPaise)}
        </span>
      </div>

      <div
        className={cn(
          'mt-1.5',
          blocked ? 'text-sm font-medium text-destructive' : 'text-xs text-muted-foreground',
        )}
      >
        {blocked ? `BLOCKED — ${plainReason(row.reasonCodes)}` : plainReason(row.reasonCodes)}
      </div>

      {blocked && row.reasonCodes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {row.reasonCodes.map((code) => (
            <span
              key={code}
              className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] text-destructive"
            >
              {code}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-muted-foreground">
        <span>#{row.seq}</span>
        <span>{(row.latencyMs * 1000).toFixed(0)}µs</span>
        {row.razorpayOrderId && <span className="truncate">{row.razorpayOrderId}</span>}
      </div>
    </div>
  )
}
