import { canonicalHash } from '@/lib/mandate/canonical'
import { verifyMandate } from '@/lib/mandate/sign'
import type { MandateRules, MandateStatus, ProposedAction } from '@/lib/mandate/schema'
import { REASON_CODES, type ReasonCode } from './reason-codes'

/**
 * ============================================================================
 *  THE POLICY ENGINE — the product.
 * ============================================================================
 *
 *  HARD RULES, non-negotiable:
 *    1. PURE. No I/O, no database, no network, no `new Date()`, no randomness.
 *       Everything time-dependent arrives via `input.now`.
 *    2. NO LLM. Not here, not in a helper, not "just for the edge cases".
 *       This function is the reason a prompt injection cannot move money.
 *    3. DETERMINISTIC. Same input => same verdict and same reason codes, in the
 *       same order, forever. The audit trail depends on being replayable.
 *    4. NOT ROUTABLE. There is deliberately no HTTP endpoint that reaches
 *       evaluate(). No network path can bypass it to reach money.
 *
 *  Every failing check appends a reason code and evaluation CONTINUES — we
 *  return all of them, not just the first. One attempt breaking three rules
 *  should show three rules broken.
 *
 *  Purity caveat, stated honestly: `latencyMs` is a wall-clock measurement and is
 *  therefore the one field that varies between identical calls. The decision
 *  itself — verdict, reasonCodes, mandateSnapshotHash — is pure.
 */

export type Verdict = 'ALLOW' | 'BLOCK' | 'ESCALATE'

/** Everything evaluate() needs about current state. Gathered by the caller. */
export interface LedgerState {
  /** Total already spent against this mandate, in paise. */
  spentPaise: number
  /** Timestamps of prior ALLOWed txns, for the velocity window. */
  recentTxnTimestamps: Date[]
  /** Idempotency keys already seen — replay detection. */
  seenIdempotencyKeys: Set<string>
}

export interface EvaluateInput {
  rules: MandateRules
  signature: string
  status: MandateStatus
  action: ProposedAction
  ledger: LedgerState
  idempotencyKey: string
  now: Date
}

export interface Decision {
  verdict: Verdict
  reasonCodes: ReasonCode[]
  /** canonicalHash of the rules at decision time — proves what was in force. */
  mandateSnapshotHash: string
  latencyMs: number
  evaluatedAt: Date
}

/** The velocity window. One hour, matching `maxTxnsPerHour`. */
export const VELOCITY_WINDOW_MS = 60 * 60 * 1000

export function evaluate(input: EvaluateInput): Decision {
  const startedAt = process.hrtime.bigint()
  const { rules, signature, status, action, ledger, idempotencyKey, now } = input

  // Fixed evaluation order. Do not reorder: the sequence of reason codes is part
  // of the audit record and is asserted by the eval suite.
  const reasonCodes: ReasonCode[] = []

  // 1. Signature — has the mandate been tampered with since it was signed?
  if (!verifyMandate(rules, signature)) {
    reasonCodes.push(REASON_CODES.SIGNATURE_INVALID)
  }

  // 2. Replay — has this exact request already been decided?
  if (ledger.seenIdempotencyKeys.has(idempotencyKey)) {
    reasonCodes.push(REASON_CODES.DUPLICATE_REQUEST)
  }

  // 3. Status — revocation is called out separately from other inactive states
  //    because "you revoked this" is a different story from "this was a draft".
  if (status === 'REVOKED') {
    reasonCodes.push(REASON_CODES.MANDATE_REVOKED)
  } else if (status !== 'ACTIVE') {
    reasonCodes.push(REASON_CODES.MANDATE_NOT_ACTIVE)
  }

  // 4. Expiry
  if (now.getTime() > new Date(rules.expiresAt).getTime()) {
    reasonCodes.push(REASON_CODES.MANDATE_EXPIRED)
  }

  // 5. Merchant allowlist — EXACT slug match. Never fuzzy: fuzzy-matching a
  //    merchant name is how "bigbasket-store" gets to spend your money.
  if (!rules.merchants.includes(action.merchantId)) {
    reasonCodes.push(REASON_CODES.MERCHANT_NOT_ALLOWLISTED)
  }

  // 6. Category allowlist
  if (!rules.categories.includes(action.category)) {
    reasonCodes.push(REASON_CODES.CATEGORY_NOT_ALLOWED)
  }

  // 7. Per-transaction cap. Boundary: spending EXACTLY the cap is allowed.
  if (action.amountPaise > rules.perTxnCapPaise) {
    reasonCodes.push(REASON_CODES.PER_TXN_CAP_EXCEEDED)
  }

  // 8. Remaining total cap. Boundary: landing exactly on the total is allowed.
  if (ledger.spentPaise + action.amountPaise > rules.totalCapPaise) {
    reasonCodes.push(REASON_CODES.TOTAL_CAP_EXCEEDED)
  }

  // 9. Velocity — count prior txns inside the rolling window.
  const windowStart = now.getTime() - VELOCITY_WINDOW_MS
  const txnsInWindow = ledger.recentTxnTimestamps.filter(
    (t) => t.getTime() > windowStart,
  ).length
  if (txnsInWindow >= rules.maxTxnsPerHour) {
    reasonCodes.push(REASON_CODES.VELOCITY_LIMIT_EXCEEDED)
  }

  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000

  return {
    verdict: reasonCodes.length === 0 ? 'ALLOW' : 'BLOCK',
    reasonCodes,
    mandateSnapshotHash: canonicalHash(rules),
    latencyMs,
    evaluatedAt: now,
  }
}
