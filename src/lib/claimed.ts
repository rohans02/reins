import { formatINR } from '@/lib/money'

/**
 * The line that shows an agent was caught relabelling something.
 *
 * Merchant, category and price are resolved from the catalog before the engine
 * sees them, so what the agent *said* it was buying is evidence rather than
 * input. When the two disagree that is the most interesting thing on the row,
 * and it should be visible without being loud: a judge should be able to see
 * that the claim was recorded and ignored.
 *
 * Returns null when nothing was claimed, or when the claim matched, so honest
 * purchases carry no extra chrome.
 */

export interface ClaimedFields {
  merchantId?: string
  category?: string
  amountPaise?: number
}

export interface ResolvedWithClaim extends ClaimedFields {
  claimed?: ClaimedFields | null
}

export function claimedLine(row: ResolvedWithClaim | null | undefined): string | null {
  const claimed = row?.claimed
  if (!row || !claimed) return null

  const differs =
    claimed.merchantId !== row.merchantId ||
    claimed.category !== row.category ||
    claimed.amountPaise !== row.amountPaise

  if (!differs) return null

  const parts = [
    claimed.merchantId,
    claimed.category,
    typeof claimed.amountPaise === 'number' ? formatINR(claimed.amountPaise) : undefined,
  ].filter(Boolean)

  return parts.length > 0 ? `claimed: ${parts.join(' · ')}` : null
}
