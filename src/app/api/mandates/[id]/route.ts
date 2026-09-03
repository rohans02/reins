import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth/session'
import { loadLedgerState } from '@/lib/agent/loop'

/**
 * GET /api/mandates/[id] — the mandate plus live spend state.
 * AI: no. Razorpay: no.
 *
 * Two spend numbers, deliberately, and they mean different things:
 *   authorizedPaise — sum of ALLOW decisions. What the cap is enforced against,
 *                     and what the spend meter shows.
 *   settledPaise    — what Razorpay has confirmed captured via webhook. Lags,
 *                     and may never arrive for a failed payment.
 *
 * In Next 16 `params` is a Promise and must be awaited.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const userId = await currentUserId()

  // 404 rather than 403 for someone else's mandate: a different status code
  // would tell an id-guesser which ids are real.
  const mandate = await prisma.mandate.findUnique({ where: { id } })
  if (!mandate || mandate.userId !== userId) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const ledger = await loadLedgerState(id)
  const rules = JSON.parse(mandate.rules) as Record<string, unknown>

  return Response.json({
    id: mandate.id,
    status: mandate.status,
    intentText: mandate.intentText,
    rules,
    signature: mandate.signature,
    totalCapPaise: mandate.totalCapPaise,
    authorizedPaise: ledger.spentPaise,
    settledPaise: mandate.spentPaise,
    remainingPaise: Math.max(0, mandate.totalCapPaise - ledger.spentPaise),
    expiresAt: mandate.expiresAt,
    signedAt: mandate.signedAt,
    revokedAt: mandate.revokedAt,
    decisionCount: ledger.seenIdempotencyKeys.size,
  })
}
