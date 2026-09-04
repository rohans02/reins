import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth/session'
import { canonicalHash } from '@/lib/mandate/canonical'
import { append } from '@/lib/ledger/append'

/**
 * POST /api/mandates/[id]/revoke — the kill switch.
 * AI: no. Razorpay: no.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const mandate = await prisma.mandate.findUnique({ where: { id } })
  if (!mandate || mandate.userId !== userId) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

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
