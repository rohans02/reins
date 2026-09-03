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
      latencyUs: number
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

/** How close to the bottom still counts as "following along", in pixels. */
const STICK_THRESHOLD_PX = 80

export function ActivityFeed({ rows }: { rows: FeedRow[] }) {
  const endRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Whether to keep pinning to the bottom. A ref, not state: it changes on every
  // scroll event and must not trigger a re-render, and updating state from a
  // scroll handler mid-stream would fight the incoming events.
  const stickToBottom = useRef(true)

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottom.current = distanceFromBottom <= STICK_THRESHOLD_PX
  }

  useEffect(() => {
    // Only follow the stream if the reader is already at the bottom. Scrolling
    // up to read an earlier row is a deliberate act, and yanking them back down
    // on the next event makes the feed unreadable exactly when it gets busy.
    if (stickToBottom.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [rows.length])

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2"
      >
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
    // A null filter means 'no filter'. The tool schema requires every field, so
    // the model sends explicit nulls — showing them is noise, not information.
    const shown = Object.fromEntries(
      Object.entries(row.input).filter(([, v]) => v !== null && v !== undefined && v !== ''),
    )
    return (
      <div className="font-mono text-[11px] text-muted-foreground break-all mg-enter">
        <span className="text-foreground/70">▸ {row.name}</span>
        {`(${JSON.stringify(shown)})`}
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
        <span>{row.latencyUs}µs</span>
        {row.razorpayOrderId && <span className="truncate">{row.razorpayOrderId}</span>}
      </div>
    </div>
  )
}
