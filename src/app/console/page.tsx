import { prisma } from '@/lib/db'
import { loadLedgerState } from '@/lib/agent/loop'
import { ConsoleClient } from '@/components/ConsoleClient'

/**
 * ★ HERO SCREEN — roughly 70% of the five-minute demo happens here.
 *
 * A Server Component loads the mandate so the page arrives with data already in
 * it: no fetch-on-mount, no loading flash, nothing to spin. The interactive half
 * lives in ConsoleClient, which refreshes this component via router.refresh()
 * after a run or a revoke.
 */
export const dynamic = 'force-dynamic'

export default async function ConsolePage() {
  const mandate = await prisma.mandate.findFirst({ orderBy: { createdAt: 'desc' } })
  if (!mandate) return <ConsoleClient mandate={null} />

  const ledger = await loadLedgerState(mandate.id)

  return (
    <ConsoleClient
      mandate={{
        id: mandate.id,
        status: mandate.status,
        intentText: mandate.intentText,
        rules: JSON.parse(mandate.rules) as never,
        totalCapPaise: mandate.totalCapPaise,
        authorizedPaise: ledger.spentPaise,
        settledPaise: mandate.spentPaise,
        expiresAt: mandate.expiresAt.toISOString(),
      }}
    />
  )
}
