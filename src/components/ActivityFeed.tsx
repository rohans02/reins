'use client'

import { useEffect, useRef } from 'react'
import { formatINR } from '@/lib/money'
import { claimedLine, type ClaimedFields } from '@/lib/claimed'
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

export interface PlannedItem {
  itemId: string
  name: string
  merchantId: string
  amountPaise: number
}

export interface MerchantBasket {
  merchantId: string
  amountPaise: number
  itemCount: number
  paymentLinkUrl: string | null
}

export type FeedRow =
  | { kind: 'say'; id: string; text: string }
  | { kind: 'settlement'; id: string; baskets: MerchantBasket[] }
  | { kind: 'tool'; id: string; name: string; input: Record<string, unknown> }
  | { kind: 'plan'; id: string; summary: string; items: PlannedItem[] }
  | {
      kind: 'verdict'
      id: string
      seq: number
      verdict: string
      reasonCodes: string[]
      merchantId: string
      itemId: string
      /** Resolved category, so the claimed line can compare against it. */
      category?: string
      amountPaise: number
      latencyUs: number
      razorpayOrderId?: string
      /** The deterministic refusal sentence. Empty or absent on ALLOW. */
      explanation?: string | null
      /** What the agent said it was buying, when it differed from the catalog. */
      claimed?: ClaimedFields | null
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

/**
 * Renders a tool call as a sentence.
 *
 * Watching an agent fire `search_catalog({"category":"groceries"})` tells you it
 * did something; it does not tell you what it is trying to do. Saying so in
 * words is the difference between a black box and an assistant you can follow.
 */
function describeToolCall(name: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  const num = (k: string) => (typeof input[k] === 'number' ? (input[k] as number) : undefined)

  if (name === 'search_catalog') {
    const bits: string[] = []
    if (str('query')) bits.push(`matching "${str('query')}"`)
    if (str('category')) bits.push(`in ${str('category')}`)
    if (str('merchantId')) bits.push(`at ${str('merchantId')}`)
    if (num('maxPricePaise')) bits.push(`under ${formatINR(num('maxPricePaise')!)}`)
    return bits.length > 0
      ? `Looking for items ${bits.join(' ')}`
      : 'Looking through the whole catalog'
  }

  if (name === 'get_item') return `Checking the details of ${str('itemId') ?? 'an item'}`

  if (name === 'request_purchase') {
    const amount = num('amountPaise')
    return `Asking to buy ${str('itemId') ?? 'an item'} from ${str('merchantId') ?? 'a merchant'}${
      amount ? ` for ${formatINR(amount)}` : ''
    }`
  }

  return `Calling ${name}`
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
    return <p className="text-sm leading-relaxed rn-enter">{row.text}</p>
  }

  if (row.kind === 'tool') {
    // A null filter means 'no filter'. The tool schema requires every field, so
    // the model sends explicit nulls — showing them is noise, not information.
    const shown = Object.fromEntries(
      Object.entries(row.input).filter(([, v]) => v !== null && v !== undefined && v !== ''),
    )
    return (
      <div className="rn-enter">
        {/* Plain English first, so the agent reads as deliberate rather than as a
            black box firing opaque calls. The raw signature stays underneath for
            anyone who wants it. */}
        <div className="text-sm text-muted-foreground flex items-baseline gap-1.5">
          <span aria-hidden className="text-foreground/50">▸</span>
          <span>{describeToolCall(row.name, shown)}</span>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground/60 break-all pl-4 mt-0.5">
          {row.name}
          {`(${JSON.stringify(shown)})`}
        </div>
      </div>
    )
  }

  if (row.kind === 'plan') {
    const total = row.items.reduce((sum, i) => sum + i.amountPaise, 0)
    return (
      <div className="rn-enter rounded-lg border border-border border-l-[3px] border-l-foreground/30 bg-card p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Planning to buy
          </span>
          <span className="font-mono text-sm font-semibold tabular-nums shrink-0">
            {formatINR(total)}
          </span>
        </div>

        {row.summary && <p className="text-sm leading-relaxed">{row.summary}</p>}

        <ul className="space-y-1">
          {row.items.map((item, i) => (
            <li
              key={`${item.itemId}-${i}`}
              className="flex items-baseline justify-between gap-3 text-xs"
            >
              <span className="min-w-0 truncate">
                {item.name}
                <span className="text-muted-foreground"> from {item.merchantId}</span>
              </span>
              <span className="font-mono tabular-nums text-muted-foreground shrink-0">
                {formatINR(item.amountPaise)}
              </span>
            </li>
          ))}
        </ul>

        {/* Said plainly, because a plan that looked like an approved basket
            would misrepresent what the engine has actually agreed to: nothing,
            yet. Every line above is still judged one at a time. */}
        <p className="text-[11px] text-muted-foreground">
          Nothing is authorized yet. Each item goes to the policy engine on its own.
        </p>
      </div>
    )
  }

  if (row.kind === 'settlement') {
    const total = row.baskets.reduce((sum, b) => sum + b.amountPaise, 0)
    return (
      // A SUMMARY, not another verdict.
      //
      // It carried the same card shell and the same emerald left border as an
      // allowed purchase, which made the run's conclusion read as one more line
      // item. The accent bar is gone because that stripe means "the engine
      // allowed this", and settlement is not a verdict. What replaces it is a
      // filled panel and a rule above, so the eye reads a change of register
      // rather than another row.
      <div className="rn-enter mt-4 border-t-2 border-border pt-4">
        <div className="rounded-lg border border-border bg-muted/50 p-4 space-y-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                To pay
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {row.baskets.length} merchant{row.baskets.length === 1 ? '' : 's'}
              </div>
            </div>
            <div className="font-mono text-2xl font-semibold tabular-nums shrink-0 leading-none">
              {formatINR(total)}
            </div>
          </div>

          {/* One row per SHOP, not per item. Nobody pays per item, and the orders
              behind each row were authorized individually. */}
          <ul className="divide-y divide-border border-y border-border">
            {row.baskets.map((b) => (
              <li key={b.merchantId} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 truncate text-sm">
                  <span className="font-mono">{b.merchantId}</span>
                  <span className="text-muted-foreground text-xs">
                    {' '}
                    · {b.itemCount} item{b.itemCount === 1 ? '' : 's'}
                  </span>
                </span>
                <span className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-sm tabular-nums">
                    {formatINR(b.amountPaise)}
                  </span>
                  {b.paymentLinkUrl ? (
                    <a
                      href={b.paymentLinkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Pay
                    </a>
                  ) : (
                    <span className="font-mono text-[10px] text-muted-foreground">no link</span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            One Razorpay Payment Link per merchant. Paying one settles every order in that
            basket.
          </p>
        </div>
      </div>
    )
  }

  if (row.kind === 'system') {
    return (
      <div
        className={cn(
          'font-mono text-[11px] rn-enter',
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
          ? 'rn-block-enter border-destructive/50 border-l-[4px] border-l-destructive p-4 shadow-sm'
          : 'rn-enter border-border border-l-[3px] border-l-emerald-600 p-3',
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
        {/* A sentence when there is one, the code summary otherwise. A block
            card that shows only chips makes a judge decode an acronym at the
            exact moment they should be understanding what happened. */}
        {blocked
          ? row.explanation || `BLOCKED — ${plainReason(row.reasonCodes)}`
          : plainReason(row.reasonCodes)}
      </div>

      {/* The relabelling evidence. Quiet on purpose: the point is that the claim
          was recorded and then ignored, not that it deserves attention. */}
      {claimedLine(row) && (
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">{claimedLine(row)}</div>
      )}

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
