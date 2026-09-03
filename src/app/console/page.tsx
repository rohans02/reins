import { prisma } from '@/lib/db'
import { loadLedgerState } from '@/lib/agent/loop'
import { ConsoleClient } from '@/components/ConsoleClient'
import type { FeedRow } from '@/components/ActivityFeed'

/**
 * ★ HERO SCREEN — roughly 70% of the five-minute demo happens here.
 *
 * A Server Component loads the mandate AND its decision history, so the page
 * arrives with data already in it: no fetch-on-mount, no loading flash.
 *
 * Seeding the feed from the ledger matters beyond convenience. Live SSE events
 * are component state, so navigating away and back — or simply reloading —
 * used to wipe the record of what the agent did. The ledger is the source of
 * truth, so the feed is rebuilt from it. Reload mid-demo and the evidence is
 * still there.
 */
export const dynamic = 'force-dynamic'

export default async function ConsolePage() {
  const mandate = await prisma.mandate.findFirst({ orderBy: { createdAt: 'desc' } })
  if (!mandate) return <ConsoleClient mandate={null} initialRows={[]} />

  const [ledger, decisions] = await Promise.all([
    loadLedgerState(mandate.id),
    prisma.decision.findMany({
      where: { mandateId: mandate.id, action: 'PURCHASE' },
      orderBy: { seq: 'asc' },
      include: { transaction: true },
      take: 100,
    }),
  ])

  // Only verdict rows survive a reload. The agent's narration is not persisted —
  // it is model output, not a decision — and inventing it back would be dishonest.
  const initialRows: FeedRow[] = decisions.map((d) => {
    const req = JSON.parse(d.requestedAction) as {
      merchantId?: string
      itemId?: string
      amountPaise?: number
    }
    return {
      kind: 'verdict',
      id: `ledger-${d.seq}`,
      seq: d.seq,
      verdict: d.verdict,
      reasonCodes: JSON.parse(d.reasonCodes) as string[],
      merchantId: req.merchantId ?? '—',
      itemId: req.itemId ?? '—',
      amountPaise: req.amountPaise ?? 0,
      latencyUs: d.latencyUs,
      razorpayOrderId: d.transaction?.razorpayOrderId ?? undefined,
    }
  })

  return (
    <ConsoleClient
      initialRows={initialRows}
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
