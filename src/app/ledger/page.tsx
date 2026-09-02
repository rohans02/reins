import { prisma } from '@/lib/db'
import { verifyChain } from '@/lib/ledger/verify'
import { LedgerTable, type LedgerRow } from '@/components/LedgerTable'

/**
 * Audit Ledger — proves nothing was hidden and nothing was altered.
 *
 * Server-rendered so the integrity check runs on request and arrives with the
 * page. No AI and no Razorpay on this screen, deliberately: it exists to be
 * checkable, so nothing on it may be probabilistic.
 */
export const dynamic = 'force-dynamic'

export default async function LedgerPage() {
  const [decisions, chain] = await Promise.all([
    prisma.decision.findMany({ orderBy: { seq: 'desc' }, include: { transaction: true }, take: 200 }),
    verifyChain(),
  ])

  const rows: LedgerRow[] = decisions.map((r) => ({
    seq: r.seq,
    createdAt: r.createdAt.toISOString(),
    action: r.action,
    verdict: r.verdict,
    reasonCodes: JSON.parse(r.reasonCodes) as string[],
    explanation: r.explanation,
    requestedAction: JSON.parse(r.requestedAction) as LedgerRow['requestedAction'],
    latencyMs: r.latencyMs,
    hash: r.hash,
    razorpayOrderId: r.transaction?.razorpayOrderId ?? null,
  }))

  return <LedgerTable rows={rows} chain={chain} />
}
