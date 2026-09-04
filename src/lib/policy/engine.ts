import { canonicalHash } from '@/lib/mandate/canonical'
import { verifyMandate } from '@/lib/mandate/sign'
import type { MandateRules, MandateStatus, ProposedAction } from '@/lib/mandate/schema'
import { REASON_CODES, type ReasonCode } from './reason-codes'

/**
 * The policy engine: a pure function, no I/O, no model call, nine checks.
 */

export type Verdict = 'ALLOW' | 'BLOCK' | 'ESCALATE'

/** Everything evaluate() needs about current state. Gathered by the caller. */
export interface LedgerState {
  spentPaise: number
  recentTxnTimestamps: Date[]
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

/**
 * The outcome of one individual check.
 */
export interface CheckResult {
  id: string
  /** Short label for the pipeline strip. */
  label: string
  passed: boolean
  reasonCode?: ReasonCode
}

export interface Decision {
  verdict: Verdict
  reasonCodes: ReasonCode[]
  checks: CheckResult[]
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

  const windowStart = now.getTime() - VELOCITY_WINDOW_MS
  const txnsInWindow = ledger.recentTxnTimestamps.filter((t) => t.getTime() > windowStart).length

  // Fixed order. Do not reorder: the sequence of reason codes is part of the
  // audit record and is asserted by the eval suite.
  const checks: CheckResult[] = [
    check('signature', 'Signature', verifyMandate(rules, signature), REASON_CODES.SIGNATURE_INVALID),

    check(
      'replay',
      'Replay',
      !ledger.seenIdempotencyKeys.has(idempotencyKey),
      REASON_CODES.DUPLICATE_REQUEST,
    ),

    // Revocation is reported separately from other inactive states, because
    // "you revoked this" is a different story from "this was still a draft".
    check(
      'status',
      'Status',
      status === 'ACTIVE',
      status === 'REVOKED' ? REASON_CODES.MANDATE_REVOKED : REASON_CODES.MANDATE_NOT_ACTIVE,
    ),

    check(
      'expiry',
      'Expiry',
      now.getTime() <= new Date(rules.expiresAt).getTime(),
      REASON_CODES.MANDATE_EXPIRED,
    ),

    // EXACT slug match, never fuzzy. Fuzzy-matching a merchant name is how
    // "bigbasket-store" gets to spend your money.
    check(
      'merchant',
      'Merchant',
      rules.merchants.includes(action.merchantId),
      REASON_CODES.MERCHANT_NOT_ALLOWLISTED,
    ),

    check(
      'category',
      'Category',
      rules.categories.includes(action.category),
      REASON_CODES.CATEGORY_NOT_ALLOWED,
    ),

    // Boundary: spending EXACTLY the cap is allowed.
    check(
      'perTxnCap',
      'Per-txn cap',
      action.amountPaise <= rules.perTxnCapPaise,
      REASON_CODES.PER_TXN_CAP_EXCEEDED,
    ),

    // Boundary: landing exactly on the total is allowed.
    check(
      'totalCap',
      'Total cap',
      ledger.spentPaise + action.amountPaise <= rules.totalCapPaise,
      REASON_CODES.TOTAL_CAP_EXCEEDED,
    ),

    check(
      'velocity',
      'Velocity',
      txnsInWindow < rules.maxTxnsPerHour,
      REASON_CODES.VELOCITY_LIMIT_EXCEEDED,
    ),
  ]

  const reasonCodes = checks
    .filter((c) => !c.passed)
    .map((c) => c.reasonCode)
    .filter((c): c is ReasonCode => Boolean(c))

  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000

  return {
    verdict: reasonCodes.length === 0 ? 'ALLOW' : 'BLOCK',
    reasonCodes,
    checks,
    mandateSnapshotHash: canonicalHash(rules),
    latencyMs,
    evaluatedAt: now,
  }
}

function check(id: string, label: string, passed: boolean, reasonCode: ReasonCode): CheckResult {
  return passed ? { id, label, passed: true } : { id, label, passed: false, reasonCode }
}
