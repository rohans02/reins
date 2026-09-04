import { formatINR } from '@/lib/money'

/**
 * The line that shows an agent was caught relabelling something.
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
