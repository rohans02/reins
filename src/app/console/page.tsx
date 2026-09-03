import { prisma } from '@/lib/db'
import { loadLedgerState, type TranscriptEntry } from '@/lib/agent/loop'
import { ConsoleClient } from '@/components/ConsoleClient'
import type { FeedRow } from '@/components/ActivityFeed'

/**
 * ★ HERO SCREEN — roughly 70% of the five-minute demo happens here.
 *
 * A Server Component loads the mandate and rebuilds the feed, so the page
 * arrives with data already in it: no fetch-on-mount, no loading flash.
 *
 * The feed is rebuilt from two sources that each own what they are good for.
 * The run transcript owns ORDER and the agent's narration. The ledger owns every
 * VERDICT, and the transcript only references those by sequence number, so there
 * is never a second copy of a decision that could drift from the audit record.
 */
export const dynamic = 'force-dynamic'

export default async function ConsolePage() {
  const mandate = await prisma.mandate.findFirst({ orderBy: { createdAt: 'desc' } })
  if (!mandate) return <ConsoleClient mandate={null} initialRows={[]} />

  const [ledger, latestRun, decisions] = await Promise.all([
    loadLedgerState(mandate.id),
    prisma.agentRun.findFirst({
      where: { mandateId: mandate.id },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.decision.findMany({
      where: { mandateId: mandate.id, action: 'PURCHASE' },
      orderBy: { seq: 'asc' },
      include: { transaction: true },
      take: 200,
    }),
  ])

  const verdictBySeq = new Map(
    decisions.map((d) => {
      const req = JSON.parse(d.requestedAction) as {
        merchantId?: string
        itemId?: string
        amountPaise?: number
      }
      const row: FeedRow = {
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
      return [d.seq, row]
    }),
  )

  const transcript: TranscriptEntry[] = latestRun
    ? (JSON.parse(latestRun.transcript) as TranscriptEntry[])
    : []

  // Replay the transcript in order. If there is no transcript — an older run, or
  // a mandate whose decisions came from a script — fall back to the verdicts
  // alone, which is what the ledger can honestly reconstruct on its own.
  const initialRows: FeedRow[] =
    transcript.length > 0
      ? transcript.flatMap((entry, i): FeedRow[] => {
          if (entry.t === 'say') return [{ kind: 'say', id: `t-${i}`, text: entry.text }]
          if (entry.t === 'system') return [{ kind: 'system', id: `t-${i}`, text: entry.text }]
          if (entry.t === 'tool') {
            return [{ kind: 'tool', id: `t-${i}`, name: entry.name, input: entry.input }]
          }
          const row = verdictBySeq.get(entry.seq)
          return row ? [row] : []
        })
      : [...verdictBySeq.values()]

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
