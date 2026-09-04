import { prisma } from '@/lib/db'
import { canonicalHash } from '@/lib/mandate/canonical'
import { MandateRulesSchema, type MandateStatus, type ProposedAction } from '@/lib/mandate/schema'
import { evaluate, type CheckResult, type LedgerState, type Verdict } from '@/lib/policy/engine'
import { explainDecision } from '@/lib/policy/explain'
import { REASON_CODES, type ReasonCode } from '@/lib/policy/reason-codes'
import { append } from '@/lib/ledger/append'
import { executePayment } from '@/lib/razorpay/execute'

/**
 * The only route from a proposal to money. Every caller comes through here, and
 * this function always runs the engine.
 */

export class MandateOwnershipError extends Error {
  constructor() {
    // Says nothing about whether the id exists, so guessing ids reveals nothing.
    super('No such mandate')
    this.name = 'MandateOwnershipError'
  }
}

export interface AuthorizeRequest {
  mandateId: string
  /** Who is spending. Required: a caller must never be able to omit it. */
  actorUserId: string
  action: ProposedAction
  /** Same id retried is a replay. A new id for the same item is a new purchase. */
  requestId: string
  agentRunId?: string | null
  now?: () => Date
  /** Seam so tests can run the full path without touching Razorpay. */
  execute?: (decisionId: string) => Promise<{ razorpayOrderId: string; paymentLinkUrl?: string | null }>
}

export interface AuthorizeResult {
  verdict: Verdict
  reasonCodes: ReasonCode[]
  checks: CheckResult[]
  seq: number
  decisionId: string
  latencyMs: number
  /** One sentence for a refusal. Empty for ALLOW. */
  explanation?: string
  /** What the agent asked for. Evidence, never input. */
  claimed: ProposedAction
  /** What the engine judged, from the catalog. Absent if the item is unknown. */
  resolved?: ProposedAction
  razorpayOrderId?: string
  paymentLinkUrl?: string | null
  /** Set when authorization succeeded but the payment call failed. */
  executionError?: string
}

export async function authorizeAndExecute(req: AuthorizeRequest): Promise<AuthorizeResult> {
  const now = req.now ?? (() => new Date())
  const execute = req.execute ?? executePayment
  const { mandateId, action } = req

  // Re-read every request, never cached, so revocation lands on the next action.
  const mandate = await prisma.mandate.findUniqueOrThrow({ where: { id: mandateId } })
  if (mandate.userId !== req.actorUserId) throw new MandateOwnershipError()

  const rules = MandateRulesSchema.parse(JSON.parse(mandate.rules))

  // The agent picks an item id, nothing more. Merchant, category and price come
  // from the catalog, or a relabelled watch would pass every check on its label.
  const item = await prisma.catalogItem.findUnique({
    where: { id: action.itemId },
    include: { merchant: true },
  })

  if (!item || !item.inStock) {
    // Nothing here but the agent's own description, so the engine is not
    // consulted and the attempt is recorded as refused.
    const idempotencyKey = canonicalHash({ requestId: req.requestId, claimed: action })
    const { seq } = await append({
      mandateId,
      agentRunId: req.agentRunId ?? null,
      action: 'PURCHASE',
      requestedAction: { claimed: action },
      verdict: 'BLOCK',
      reasonCodes: [REASON_CODES.ITEM_UNKNOWN],
      explanation: 'That item is not in the catalog.',
      mandateSnapshotHash: canonicalHash(rules),
      idempotencyKey,
      latencyMs: 0,
    })
    const unknownRow = await prisma.decision.findUniqueOrThrow({
      where: { seq },
      select: { id: true },
    })
    return {
      verdict: 'BLOCK',
      reasonCodes: [REASON_CODES.ITEM_UNKNOWN],
      checks: [],
      seq,
      decisionId: unknownRow.id,
      latencyMs: 0,
      explanation: 'That item is not in the catalog.',
      claimed: action,
    }
  }

  const resolved: ProposedAction = {
    merchantId: item.merchantId,
    itemId: item.id,
    category: item.category,
    amountPaise: item.pricePaise,
  }

  const ledger = await loadLedgerState(mandateId)

  // Keyed on the resolved action, so two different lies about one item collide
  // as a replay instead of passing as two requests.
  const idempotencyKey = canonicalHash({ requestId: req.requestId, action: resolved })

  const decision = evaluate({
    rules,
    signature: mandate.signature,
    status: mandate.status as MandateStatus,
    action: resolved,
    ledger,
    idempotencyKey,
    now: now(),
  })

  // After the verdict, never fed back into it, and deterministic so it survives
  // every external service being down.
  const explanation = explainDecision({
    verdict: decision.verdict,
    reasonCodes: decision.reasonCodes,
    amountPaise: resolved.amountPaise,
    rules,
    merchantId: resolved.merchantId,
    spentPaise: ledger.spentPaise,
  })

  // Recorded before execution, allowed or refused alike. Resolved fields sit at
  // the top level, which is what execute.ts reads; claimed is evidence only.
  const { seq } = await append({
    explanation: explanation || null,
    mandateId,
    agentRunId: req.agentRunId ?? null,
    action: 'PURCHASE',
    requestedAction: { ...resolved, claimed: action },
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
    explanation,
    claimed: action,
    resolved,
  }

  // Status correction, not enforcement: the engine already refused. Lazy, so a
  // mandate nobody touches again stays ACTIVE until something is attempted.
  if (
    mandate.status === 'ACTIVE' &&
    decision.reasonCodes.includes(REASON_CODES.MANDATE_EXPIRED)
  ) {
    await prisma.mandate.update({ where: { id: mandateId }, data: { status: 'EXPIRED' } })
  }

  if (decision.verdict !== 'ALLOW') return base

  // Same for a spent-out mandate. Resolved price, never the claimed one.
  const remaining = rules.totalCapPaise - (ledger.spentPaise + resolved.amountPaise)
  if (remaining <= 0) {
    await prisma.mandate.update({
      where: { id: mandateId },
      data: { status: 'EXHAUSTED' },
    })
  }

  try {
    const { razorpayOrderId, paymentLinkUrl } = await execute(row.id)
    return { ...base, razorpayOrderId, paymentLinkUrl }
  } catch (err) {
    // Authorized but not executed. The decision is recorded, so a retry is safe.
    return { ...base, executionError: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Counts AUTHORIZED spend, not settled. Settled lags behind a webhook, and an
 * agent could authorize ten more purchases inside that lag window.
 */
export async function loadLedgerState(mandateId: string): Promise<LedgerState> {
  // Not owner-scoped on purpose: this is what the engine enforces against, so it
  // must be complete. Ownership is settled before anything reaches here.
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
