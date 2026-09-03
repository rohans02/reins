import { prisma } from '@/lib/db'
import { canonicalHash } from '@/lib/mandate/canonical'
import { MandateRulesSchema, type MandateStatus, type ProposedAction } from '@/lib/mandate/schema'
import { evaluate, type CheckResult, type LedgerState, type Verdict } from '@/lib/policy/engine'
import type { ReasonCode } from '@/lib/policy/reason-codes'
import { append } from '@/lib/ledger/append'
import { executePayment } from '@/lib/razorpay/execute'

/**
 * ============================================================================
 *  THE AUTHORIZATION PATH — the only route from a proposal to money.
 * ============================================================================
 *
 * Every caller that wants to spend goes through `authorizeAndExecute`. Today
 * that is the buyer agent. Tomorrow it may also be an MCP server, letting an
 * outside agent act under the same mandate.
 *
 * This lives in its own module for one reason: there must be exactly ONE
 * implementation of "evaluate, record, then maybe pay". It used to sit inside
 * the agent loop, tangled up with the loop's event stream, which meant a second
 * caller would have had to reimplement it — and two code paths to money is
 * precisely the thing the architecture claims does not exist.
 *
 * The engine is still not reachable from the network. A caller may reach THIS
 * function, and this function always runs the engine. Nothing skips it.
 */

export interface AuthorizeRequest {
  mandateId: string
  action: ProposedAction
  /**
   * Stable identifier for this request. The same id retried is treated as a
   * replay and refused. A different id for the same item is a new purchase and
   * is allowed, which is what makes buying milk again next week legitimate.
   */
  requestId: string
  agentRunId?: string | null
  /** Injectable clock, so the engine stays testable and pure. */
  now?: () => Date
  /** Seam so tests can exercise the full path without touching Razorpay. */
  execute?: (decisionId: string) => Promise<{ razorpayOrderId: string }>
}

export interface AuthorizeResult {
  verdict: Verdict
  reasonCodes: ReasonCode[]
  checks: CheckResult[]
  seq: number
  decisionId: string
  latencyMs: number
  /** Present only when the purchase was authorized AND executed. */
  razorpayOrderId?: string
  /** Set when authorization succeeded but the payment call failed. */
  executionError?: string
}

export async function authorizeAndExecute(req: AuthorizeRequest): Promise<AuthorizeResult> {
  const now = req.now ?? (() => new Date())
  const execute = req.execute ?? executePayment
  const { mandateId, action } = req

  // Re-read the mandate on EVERY request. Status is never cached across turns,
  // which is what makes revocation take effect on the very next action rather
  // than at the end of a run.
  const mandate = await prisma.mandate.findUniqueOrThrow({ where: { id: mandateId } })
  const rules = MandateRulesSchema.parse(JSON.parse(mandate.rules))
  const ledger = await loadLedgerState(mandateId)

  const idempotencyKey = canonicalHash({ requestId: req.requestId, action })

  const decision = evaluate({
    rules,
    signature: mandate.signature,
    status: mandate.status as MandateStatus,
    action,
    ledger,
    idempotencyKey,
    now: now(),
  })

  // Recorded before anything is executed, and recorded whether it allowed or
  // refused. The refusals are the half that proves the system works.
  const { seq } = await append({
    mandateId,
    agentRunId: req.agentRunId ?? null,
    action: 'PURCHASE',
    requestedAction: action,
    verdict: decision.verdict,
    reasonCodes: decision.reasonCodes,
    mandateSnapshotHash: decision.mandateSnapshotHash,
    idempotencyKey,
    latencyMs: decision.latencyMs,
  })

  const row = await prisma.decision.findUniqueOrThrow({ where: { seq }, select: { id: true } })

  const base: AuthorizeResult = {
    verdict: decision.verdict,
    reasonCodes: decision.reasonCodes,
    checks: decision.checks,
    seq,
    decisionId: row.id,
    latencyMs: decision.latencyMs,
  }

  if (decision.verdict !== 'ALLOW') return base

  try {
    const { razorpayOrderId } = await execute(row.id)
    return { ...base, razorpayOrderId }
  } catch (err) {
    // Authorization succeeded but execution failed. The mandate state is intact
    // and the decision is already recorded, so a retry is safe and idempotent.
    return { ...base, executionError: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Spend counted against the cap is AUTHORIZED spend — the sum of ALLOW
 * decisions — not settled spend.
 *
 * This matters. `Mandate.spentPaise` is incremented by the Razorpay webhook when
 * a payment actually captures, which can lag by seconds or never arrive. If the
 * engine enforced against that, an agent could authorize ten purchases inside
 * the lag window and blow the total cap while every individual check passed. We
 * reserve against the cap the moment we authorize.
 */
export async function loadLedgerState(mandateId: string): Promise<LedgerState> {
  const decisions = await prisma.decision.findMany({
    where: { mandateId },
    select: {
      verdict: true,
      action: true,
      requestedAction: true,
      createdAt: true,
      idempotencyKey: true,
    },
  })

  let spentPaise = 0
  const recentTxnTimestamps: Date[] = []
  const seenIdempotencyKeys = new Set<string>()

  for (const d of decisions) {
    seenIdempotencyKeys.add(d.idempotencyKey)
    if (d.verdict === 'ALLOW' && d.action === 'PURCHASE') {
      const requested = JSON.parse(d.requestedAction) as { amountPaise?: number }
      spentPaise += requested.amountPaise ?? 0
      recentTxnTimestamps.push(d.createdAt)
    }
  }

  return { spentPaise, recentTxnTimestamps, seenIdempotencyKeys }
}
