import { prisma } from '@/lib/db'
import type { TranscriptEntry } from '@/lib/agent/loop'
import { requireActor } from '@/lib/auth/guard'
import { loadMandateSummaries, pickMandate } from '@/lib/mandates/summary'
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
 *
 * WHICH MANDATE. More than one can be live, so the console works on exactly one
 * at a time and says which. It comes from `?mandate=`, falling back to the
 * newest live one. Naming it in the URL rather than holding it in a session
 * keeps the choice explicit: a run is always bound to the mandate on screen.
 */
export const dynamic = 'force-dynamic'

export default async function ConsolePage({
  searchParams,
}: PageProps<'/console'>) {
  const requested = (await searchParams).mandate
  // Scoped to the caller, so `?mandate=` naming someone else's id resolves to
  // nothing and falls back to their own rather than rendering it.
  const actor = await requireActor()
  const summaries = await loadMandateSummaries(actor.id)
  const mandate = pickMandate(summaries, typeof requested === 'string' ? requested : undefined)

  // Only live mandates can be switched to, because a run started against a
  // revoked or exhausted one is refused on its first purchase anyway.
  const switchable = summaries
    .filter((m) => m.live || m.id === mandate?.id)
    .map((m) => ({ id: m.id, intentText: m.intentText, live: m.live }))

  if (!mandate) {
    return <ConsoleClient mandate={null} initialRows={[]} switchable={[]} />
  }

  const [latestRun, decisions] = await Promise.all([
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
      // Top level is what the engine judged. `claimed` is what the agent said,
      // preserved so a relabelling attempt survives a reload.
      const req = JSON.parse(d.requestedAction) as {
        merchantId?: string
        itemId?: string
        category?: string
        amountPaise?: number
        claimed?: { merchantId?: string; category?: string; amountPaise?: number } | null
      }
      const row: FeedRow = {
        kind: 'verdict',
        id: `ledger-${d.seq}`,
        seq: d.seq,
        verdict: d.verdict,
        reasonCodes: JSON.parse(d.reasonCodes) as string[],
        merchantId: req.merchantId ?? req.claimed?.merchantId ?? '—',
        itemId: req.itemId ?? '—',
        category: req.category,
        amountPaise: req.amountPaise ?? req.claimed?.amountPaise ?? 0,
        claimed: req.claimed ?? null,
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
          if (entry.t === 'plan') {
            return [{ kind: 'plan', id: `t-${i}`, summary: entry.summary, items: entry.items }]
          }
          const row = verdictBySeq.get(entry.seq)
          return row ? [row] : []
        })
      : [...verdictBySeq.values()]

  return (
    <ConsoleClient
      initialRows={initialRows}
      switchable={switchable}
      mandate={{
        id: mandate.id,
        status: mandate.status,
        intentText: mandate.intentText,
        rules: mandate.rules,
        totalCapPaise: mandate.totalCapPaise,
        authorizedPaise: mandate.authorizedPaise,
        settledPaise: mandate.settledPaise,
        expiresAt: mandate.expiresAt,
      }}
    />
  )
}
