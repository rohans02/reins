import { prisma } from '@/lib/db'
import { GENESIS_HASH, computeRowHash, type LedgerDigest } from './chain'

/**
 * Recompute the entire chain and report the first divergence.
 *
 * Powers the "Chain verified" badge — a claim a judge can check, not one we
 * assert.
 *
 * NOTE: this deliberately takes no mandate filter. The chain is global: row N's
 * prevHash points at row N-1 across ALL mandates. Verifying a per-mandate subset
 * would skip rows and report false corruption. The Ledger screen may *filter*
 * what it displays, but integrity is always verified over the whole ledger.
 */
export interface ChainVerification {
  verified: boolean
  entriesChecked: number
  /** seq of the first row whose hash does not match. null when intact. */
  brokenAtSeq: number | null
}

export async function verifyChain(): Promise<ChainVerification> {
  const rows = await prisma.decision.findMany({ orderBy: { seq: 'asc' } })

  let prevHash = GENESIS_HASH

  for (const row of rows) {
    const digest: LedgerDigest = {
      seq: row.seq,
      mandateId: row.mandateId,
      agentRunId: row.agentRunId,
      action: row.action,
      requestedAction: row.requestedAction,
      verdict: row.verdict,
      reasonCodes: JSON.parse(row.reasonCodes) as string[],
      mandateSnapshotHash: row.mandateSnapshotHash,
      idempotencyKey: row.idempotencyKey,
      latencyMs: row.latencyMs,
      createdAt: row.createdAt.toISOString(),
    }

    // Two ways the chain breaks: the row's own contents were edited, or a row
    // was removed/reordered so the link no longer points at its predecessor.
    if (row.prevHash !== prevHash || computeRowHash(prevHash, digest) !== row.hash) {
      return { verified: false, entriesChecked: rows.length, brokenAtSeq: row.seq }
    }

    prevHash = row.hash
  }

  return { verified: true, entriesChecked: rows.length, brokenAtSeq: null }
}
