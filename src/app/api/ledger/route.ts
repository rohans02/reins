import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth/session'
import { verifyChain } from '@/lib/ledger/verify'

/**
 * GET /api/ledger — the audit trail plus a live chain verification.
 * AI: no. Razorpay: no. Deliberately deterministic: this screen exists to prove
 * nothing was hidden or altered, so nothing on it may be probabilistic.
 *
 * `mandateId` filters what is DISPLAYED, and the caller only ever sees rows for
 * their OWN mandates.
 *
 * Integrity is still verified over the WHOLE chain, everyone's rows included,
 * because prevHash links every row regardless of owner. That split is the point:
 * what you can READ is scoped to you, what is VERIFIED is the entire ledger. A
 * chain that only covered your own rows could have another row removed from
 * between two of them and still verify.
 */
export async function GET(request: Request) {
  const mandateId = new URL(request.url).searchParams.get('mandateId') ?? undefined
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const [rows, chain] = await Promise.all([
    prisma.decision.findMany({
      where: { mandate: { userId }, ...(mandateId ? { mandateId } : {}) },
      orderBy: { seq: 'desc' },
      include: { transaction: true },
      take: 200,
    }),
    verifyChain(),
  ])

  return Response.json({
    chain,
    decisions: rows.map((r) => ({
      seq: r.seq,
      createdAt: r.createdAt,
      action: r.action,
      verdict: r.verdict,
      reasonCodes: JSON.parse(r.reasonCodes) as string[],
      explanation: r.explanation,
      requestedAction: JSON.parse(r.requestedAction) as Record<string, unknown>,
      latencyUs: r.latencyUs,
      hash: r.hash,
      razorpayOrderId: r.transaction?.razorpayOrderId ?? null,
    })),
  })
}
