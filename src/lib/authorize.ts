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
 *
 * OWNERSHIP is checked here as well as at the API edge, on purpose. A mandate id
 * is a bearer token if nothing verifies who is holding it, and ids travel: they
 * sit in URLs, in tool arguments, and eventually in whatever an MCP client sends
 * us. So the single money path refuses a mandate that does not belong to the
 * actor, and it refuses BEFORE the engine runs, because a mandate that is not
 * yours is not a policy question. It is not yours.
 */

/** Raised when an actor references a mandate that is not theirs. */
export class MandateOwnershipError extends Error {
  constructor() {
    // Deliberately says nothing about whether the id exists. Distinguishing
    // "not yours" from "no such mandate" would confirm the existence of other
    // people's mandates to anyone willing to guess ids.
    super('No such mandate')
    this.name = 'MandateOwnershipError'
  }
}

export interface AuthorizeRequest {
  mandateId: string
  /** Who is spending. Required: a caller must never be able to omit it. */
  actorUserId: string
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
  if (mandate.userId !== req.actorUserId) throw new MandateOwnershipError()

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

  // A mandate with nothing left to spend is finished, and should say so rather
  // than sitting at ACTIVE and refusing everything with TOTAL_CAP_EXCEEDED.
  // Purely a status correction: the engine already refuses on the cap, so this
  // changes what the UI shows, not what is enforced.
  const remaining = rules.totalCapPaise - (ledger.spentPaise + action.amountPaise)
  if (remaining <= 0) {
    await prisma.mandate.update({
      where: { id: mandateId },
      data: { status: 'EXHAUSTED' },
    })
  }

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
  // Not owner-scoped, and it must not be: this is the spend the ENGINE enforces
  // against for one specific mandate, and it has to be complete regardless of
  // who is asking. Ownership is settled before this is ever reached.
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
