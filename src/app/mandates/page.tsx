import { requireActor } from '@/lib/auth/guard'
import {
  loadMandateSummaries,
  remainingPaise,
  totalLiveExposurePaise,
} from '@/lib/mandates/summary'
import { MandateManager, type ManagedMandate } from '@/components/MandateManager'

/**
 * Mandates — the manager for every piece of spending authority.
 */
export const dynamic = 'force-dynamic'

export default async function MandatesPage() {
  const actor = await requireActor()
  const summaries = await loadMandateSummaries(actor.id)

  const mandates: ManagedMandate[] = summaries.map((m) => ({
    id: m.id,
    status: m.status,
    intentText: m.intentText,
    merchants: m.rules.merchants,
    categories: m.rules.categories,
    perTxnCapPaise: m.rules.perTxnCapPaise,
    maxTxnsPerHour: m.rules.maxTxnsPerHour,
    totalCapPaise: m.totalCapPaise,
    authorizedPaise: m.authorizedPaise,
    remainingPaise: remainingPaise(m),
    purchaseCount: m.purchaseCount,
    signature: m.signature,
    expiresAt: m.expiresAt,
    createdAt: m.createdAt,
    live: m.live,
  }))

  return (
    <MandateManager
      mandates={mandates}
      totalExposurePaise={totalLiveExposurePaise(summaries)}
    />
  )
}
