import { prisma } from '@/lib/db'
import { canonicalHash } from '@/lib/mandate/canonical'
import { append } from '@/lib/ledger/append'

/**
 * POST /api/mandates/[id]/revoke — the kill switch.
 * AI: no. Razorpay: no.
 *
 * Revocation is a single status write, and that is the whole point: the policy
 * engine re-reads status on EVERY proposal, so the agent's very next action is
 * refused. Nothing is queued, nothing drains, no in-flight grace period.
 *
 * Already-revoked is not an error — the button should be safe to hit twice, and
 * on stage it will be.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const mandate = await prisma.mandate.findUnique({ where: { id } })
  if (!mandate) return Response.json({ error: 'not_found' }, { status: 404 })

  if (mandate.status === 'REVOKED') {
    return Response.json({ status: 'REVOKED', alreadyRevoked: true })
  }

  const revokedAt = new Date()
  await prisma.mandate.update({ where: { id }, data: { status: 'REVOKED', revokedAt } })

  const { seq } = await append({
    mandateId: id,
    action: 'MANDATE_REVOKED',
    requestedAction: { revokedAt: revokedAt.toISOString() },
    verdict: 'ALLOW',
    reasonCodes: [],
    mandateSnapshotHash: canonicalHash(JSON.parse(mandate.rules)),
    idempotencyKey: canonicalHash({ revoked: id, at: revokedAt.toISOString() }),
    latencyMs: 0,
  })

  return Response.json({ status: 'REVOKED', ledgerSeq: seq })
}
