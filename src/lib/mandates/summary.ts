import { prisma } from '@/lib/db'
import { MandateRulesSchema, type MandateRules } from '@/lib/mandate/schema'

/**
 * Mandate summaries: one owner-scoped read that every screen shares.
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
 */
export async function loadMandateSummaries(
  userId: string,
  now: Date = new Date(),
): Promise<MandateSummary[]> {
  const [mandates, decisions] = await Promise.all([
    prisma.mandate.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    prisma.decision.findMany({
      // Scoped through the mandate, so one person's spend can never be counted
      // against another's cap or appear in their totals.
      where: { action: 'PURCHASE', verdict: 'ALLOW', mandate: { userId } },
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
