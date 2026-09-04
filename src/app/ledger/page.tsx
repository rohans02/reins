import { prisma } from '@/lib/db'
import { requireActor } from '@/lib/auth/guard'
import { verifyChain } from '@/lib/ledger/verify'
import { LedgerTable, type LedgerRow } from '@/components/LedgerTable'

/**
 * Audit Ledger — proves nothing was hidden and nothing was altered.
 *
 * Server-rendered so the integrity check runs on request and arrives with the
 * page. No AI and no Razorpay on this screen, deliberately: it exists to be
 * checkable, so nothing on it may be probabilistic.
 *
 * You see YOUR decisions. Integrity is verified over the WHOLE chain, everyone's
 * rows included, because prevHash links every row regardless of owner. Reading
 * is scoped, verification is not — a chain covering only your own rows could
 * have another row lifted out from between two of them and still verify.
 */
export const dynamic = 'force-dynamic'

export default async function LedgerPage() {
  const { id: userId } = await requireActor()

  const [decisions, chain] = await Promise.all([
    prisma.decision.findMany({
      where: { mandate: { userId } },
      orderBy: { seq: 'desc' },
      include: { transaction: true, mandate: { select: { intentText: true } } },
      take: 200,
    }),
    verifyChain(),
  ])

  // One chain across every mandate, always. A per-mandate chain could omit a
  // decision and still verify, which would defeat the point of having one.
  // Mandate is therefore a label and a filter, never a separate sequence.
  const rows: LedgerRow[] = decisions.map((r) => ({
    seq: r.seq,
    mandateId: r.mandateId,
    mandateLabel: shortLabel(r.mandate.intentText, r.mandateId),
    createdAt: r.createdAt.toISOString(),
    action: r.action,
    verdict: r.verdict,
    reasonCodes: JSON.parse(r.reasonCodes) as string[],
    explanation: r.explanation,
    requestedAction: JSON.parse(r.requestedAction) as LedgerRow['requestedAction'],
    latencyUs: r.latencyUs,
    hash: r.hash,
    razorpayOrderId: r.transaction?.razorpayOrderId ?? null,
    paymentLinkUrl: r.transaction?.razorpayPaymentLinkUrl ?? null,
  }))

  return <LedgerTable rows={rows} chain={chain} />
}

/** Enough of the intent to tell two mandates apart in a narrow column. */
function shortLabel(intentText: string, id: string): string {
  const text = intentText.trim()
  if (!text) return id.slice(0, 10)
  return text.length > 28 ? `${text.slice(0, 27).trimEnd()}…` : text
}
