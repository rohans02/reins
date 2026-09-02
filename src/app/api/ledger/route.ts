import { prisma } from '@/lib/db'
import { verifyChain } from '@/lib/ledger/verify'

/**
 * GET /api/ledger — the audit trail plus a live chain verification.
 * AI: no. Razorpay: no. Deliberately deterministic: this screen exists to prove
 * nothing was hidden or altered, so nothing on it may be probabilistic.
 *
 * `mandateId` filters what is DISPLAYED. Integrity is always verified over the
 * whole chain, because prevHash links rows across all mandates.
 */
export async function GET(request: Request) {
  const mandateId = new URL(request.url).searchParams.get('mandateId') ?? undefined

  const [rows, chain] = await Promise.all([
    prisma.decision.findMany({
      where: mandateId ? { mandateId } : undefined,
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
      latencyMs: r.latencyMs,
      hash: r.hash,
      razorpayOrderId: r.transaction?.razorpayOrderId ?? null,
    })),
  })
}
