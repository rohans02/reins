import { formatINR } from '@/lib/money'
import type { MandateRules } from '@/lib/mandate/schema'
import type { ReasonCode } from '@/lib/policy/reason-codes'

/**
 * One sentence saying why a purchase was refused.
 *
 * Pure. No I/O, no model, no network. That is the point rather than a
 * convenience: the sentence on a block card must exist even when every external
 * service is down, because the block itself did. An LLM version could sit behind
 * this same signature later without moving anything.
 *
 * It covers EVERY code present. A refusal that broke four rules and explains one
 * of them is a worse artefact than the raw codes, because it implies the other
 * three did not happen.
 *
 * Returns '' for ALLOW. There is nothing to explain about a purchase that went
 * through, and a green card carrying a sentence would dilute the red one.
 */

export interface ExplainInput {
  verdict: string
  reasonCodes: ReasonCode[] | string[]
  amountPaise: number
  rules: MandateRules
  merchantId: string
  /** Authorized spend BEFORE this attempt, for the remaining-total wording. */
  spentPaise: number
}

export function explainDecision(input: ExplainInput): string {
  if (input.verdict === 'ALLOW') return ''

  const { reasonCodes, amountPaise, rules, merchantId, spentPaise } = input
  const has = (code: string) => (reasonCodes as string[]).includes(code)

  // `literal` marks a clause that opens with an identifier or an amount, which
  // must not be sentence-capitalised. "Luxe-store" is not the merchant id, and
  // a sentence that silently rewrites an identifier is a small lie in a product
  // whose whole claim is that the record is exact.
  const clauses: Array<{ text: string; literal?: boolean }> = []

  // Ordered so the most concrete reason leads. "Over the cap" tells you more
  // than "the mandate is not active", and the leading clause is the one people
  // read.
  if (has('ITEM_UNKNOWN')) {
    clauses.push({ text: 'that item is not in the catalog' })
  }
  if (has('PER_TXN_CAP_EXCEEDED')) {
    clauses.push({
      text: `${formatINR(amountPaise)} is over the ${formatINR(rules.perTxnCapPaise)} per-order cap`,
      literal: true,
    })
  }
  if (has('TOTAL_CAP_EXCEEDED')) {
    const left = Math.max(0, rules.totalCapPaise - spentPaise)
    clauses.push({ text: `only ${formatINR(left)} is left on the mandate` })
  }
  if (has('MERCHANT_NOT_ALLOWLISTED')) {
    clauses.push({ text: `${merchantId} is not an allowed merchant`, literal: true })
  }
  if (has('CATEGORY_NOT_ALLOWED')) {
    clauses.push({ text: 'the category is not permitted' })
  }
  if (has('VELOCITY_LIMIT_EXCEEDED')) {
    clauses.push({ text: `the limit of ${rules.maxTxnsPerHour} orders an hour is used up` })
  }
  if (has('MANDATE_REVOKED')) clauses.push({ text: 'the mandate was revoked' })
  if (has('MANDATE_EXPIRED')) clauses.push({ text: 'the mandate has expired' })
  if (has('MANDATE_NOT_ACTIVE')) clauses.push({ text: 'the mandate is not active' })
  if (has('SIGNATURE_INVALID')) clauses.push({ text: 'the mandate signature does not verify' })
  if (has('DUPLICATE_REQUEST')) clauses.push({ text: 'this request was already seen' })

  if (clauses.length === 0) return 'Refused by the policy engine.'

  const head = clauses[0]
  const parts = clauses.map((c, i) => (i === 0 && !head.literal ? capitalise(c.text) : c.text))

  return `${joinClauses(parts)}.`
}

/** Oxford-free join: "a, b and c". */
function joinClauses(parts: string[]): string {
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function capitalise(s: string): string {
  if (!s) return s
  return s[0].toUpperCase() + s.slice(1)
}
