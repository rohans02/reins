import { prisma } from '@/lib/db'
import { MandateRulesSchema, type MandateRules } from '@/lib/mandate/schema'

/**
 * ============================================================================
 *  MANDATE SUMMARIES — one read that every screen shares.
 * ============================================================================
 *
 * More than one mandate can be in force at once. A person may run a grocery
 * agent and a pharmacy agent side by side, on separate budgets, and collapsing
 * those into a single "the mandate" was a limitation of the UI rather than of
 * the engine: the policy engine, the ledger and the money path have always been
 * scoped by mandate id.
 *
 * Concurrent authority is only safe while ALL of it is visible. An earlier
 * build superseded the previous mandate whenever a new one was signed, because
 * the console showed only the newest and an older ACTIVE mandate became
 * spendable authority nobody could see. Superseding is no longer needed, and
 * what replaces it is stricter: every mandate is listed, and the total live
 * exposure across all of them is stated in one number.
 *
 * Spend is read from the LEDGER, not from `Mandate.spentPaise`. The column
 * tracks settled payments and lags behind by a webhook. Authority is consumed
 * the moment a purchase is authorized, so that is what has to be counted.
 */

export interface MandateSummary {
  id: string
  status: string
  intentText: string
  rules: MandateRules
  signature: string
  totalCapPaise: number
  /** Sum of ALLOWed purchases. This is what the engine enforces against. */
  authorizedPaise: number
  /** Sum captured by Razorpay webhooks. Lags, and may never arrive. */
  settledPaise: number
  expiresAt: string
  createdAt: string
  /** ALLOWed purchases, for a per-mandate order count. */
  purchaseCount: number
  /** True when this mandate could authorize a purchase right now. */
  live: boolean
}

/** Whatever is left to spend, floored at zero. */
export function remainingPaise(m: MandateSummary): number {
  return Math.max(0, m.totalCapPaise - m.authorizedPaise)
}

/**
 * Loads every mandate with its authorized spend.
 *
 * Two queries regardless of how many mandates exist, rather than one ledger
 * read per mandate. The manager lists all of them at once and an N+1 there
 * would be felt.
 */
export async function loadMandateSummaries(now: Date = new Date()): Promise<MandateSummary[]> {
  const [mandates, decisions] = await Promise.all([
    prisma.mandate.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.decision.findMany({
      where: { action: 'PURCHASE', verdict: 'ALLOW' },
      select: { mandateId: true, requestedAction: true },
    }),
  ])

  const spendByMandate = new Map<string, { paise: number; count: number }>()
  for (const d of decisions) {
    const { amountPaise = 0 } = JSON.parse(d.requestedAction) as { amountPaise?: number }
    const acc = spendByMandate.get(d.mandateId) ?? { paise: 0, count: 0 }
    acc.paise += amountPaise
    acc.count += 1
    spendByMandate.set(d.mandateId, acc)
  }

  return mandates.map((m) => {
    const spend = spendByMandate.get(m.id) ?? { paise: 0, count: 0 }
    const rules = MandateRulesSchema.parse(JSON.parse(m.rules))
    return {
      id: m.id,
      status: m.status,
      intentText: m.intentText,
      rules,
      signature: m.signature,
      totalCapPaise: m.totalCapPaise,
      authorizedPaise: spend.paise,
      settledPaise: m.spentPaise,
      purchaseCount: spend.count,
      expiresAt: m.expiresAt.toISOString(),
      createdAt: m.createdAt.toISOString(),
      // Mirrors what the engine would decide on the status, expiry and total
      // cap checks. It is a DISPLAY value and nothing is enforced with it: the
      // engine re-derives all of this from the database on every request.
      live:
        m.status === 'ACTIVE' &&
        m.expiresAt.getTime() > now.getTime() &&
        spend.paise < m.totalCapPaise,
    }
  })
}

/**
 * Total money that could still be spent right now, across every live mandate.
 *
 * The number that actually matters once concurrent mandates exist. Any single
 * mandate understates the exposure, and this is the figure a person needs
 * before deciding whether to revoke something.
 */
export function totalLiveExposurePaise(mandates: MandateSummary[]): number {
  return mandates.filter((m) => m.live).reduce((sum, m) => sum + remainingPaise(m), 0)
}

/**
 * The mandate a screen should default to when none is named in the URL: the
 * newest live one, falling back to the newest of any kind so a revoked or
 * exhausted mandate still has somewhere to be inspected.
 */
export function defaultMandate(mandates: MandateSummary[]): MandateSummary | null {
  return mandates.find((m) => m.live) ?? mandates[0] ?? null
}

/** Resolves an id from the URL, ignoring one that does not exist. */
export function pickMandate(mandates: MandateSummary[], id?: string): MandateSummary | null {
  if (id) {
    const found = mandates.find((m) => m.id === id)
    if (found) return found
  }
  return defaultMandate(mandates)
}
