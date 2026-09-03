import { prisma } from '@/lib/db'
import { canonical } from '@/lib/mandate/canonical'
import { GENESIS_HASH, computeRowHash, type LedgerDigest } from './chain'

/**
 * Append-only, SHA-256 hash-chained audit ledger.
 *
 *   hash = sha256(canonical({ prevHash, ...digest }))
 *
 * Rows are NEVER updated and NEVER deleted. Both ALLOW and BLOCK are recorded —
 * the blocks are the interesting half.
 */

export interface LedgerEntry {
  mandateId: string
  agentRunId?: string | null
  action:
    | 'PURCHASE'
    | 'MANDATE_ISSUED'
    | 'MANDATE_REVOKED'
    | 'MANDATE_SUPERSEDED'
    | 'AGENT_ERROR'
  requestedAction: unknown
  verdict: 'ALLOW' | 'BLOCK' | 'ESCALATE'
  reasonCodes: string[]
  explanation?: string | null
  mandateSnapshotHash: string
  idempotencyKey: string
  latencyMs: number
}

/**
 * CONCURRENCY MUTEX.
 *
 * The SSE agent stream and the Razorpay webhook handler both write here. Two
 * concurrent appends would read the same `prevHash` and fork the chain, which
 * verifyChain() would then report as corruption. Serialising every append behind
 * one promise chain is the whole fix.
 *
 * Single-process only, which is exactly the prototype's deployment. At real
 * scale this becomes a DB-level sequence or an advisory lock — worth saying out
 * loud at panel rather than pretending the mutex scales.
 */
let tail: Promise<unknown> = Promise.resolve()

export async function append(entry: LedgerEntry): Promise<{ seq: number; hash: string }> {
  // `.catch` first so one failed append does not wedge the queue forever.
  const run = tail.catch(() => undefined).then(() => appendSerialized(entry))
  tail = run.catch(() => undefined)
  return run
}

async function appendSerialized(entry: LedgerEntry): Promise<{ seq: number; hash: string }> {
  const last = await prisma.decision.findFirst({
    orderBy: { seq: 'desc' },
    select: { seq: true, hash: true },
  })

  const seq = (last?.seq ?? 0) + 1
  const prevHash = last?.hash ?? GENESIS_HASH
  const createdAt = new Date()

  const digest: LedgerDigest = {
    seq,
    mandateId: entry.mandateId,
    agentRunId: entry.agentRunId ?? null,
    action: entry.action,
    requestedAction: canonical(entry.requestedAction),
    verdict: entry.verdict,
    reasonCodes: entry.reasonCodes,
    mandateSnapshotHash: entry.mandateSnapshotHash,
    idempotencyKey: entry.idempotencyKey,
    // Stored as an Int, so round before hashing — the hash must be computed over
    // the value that actually lands in the row, not the pre-rounded float.
    latencyMs: Math.round(entry.latencyMs),
    createdAt: createdAt.toISOString(),
  }

  const hash = computeRowHash(prevHash, digest)

  await prisma.decision.create({
    data: {
      seq: digest.seq,
      mandateId: digest.mandateId,
      agentRunId: digest.agentRunId,
      action: digest.action,
      requestedAction: digest.requestedAction,
      verdict: digest.verdict,
      reasonCodes: JSON.stringify(digest.reasonCodes),
      explanation: entry.explanation ?? null,
      mandateSnapshotHash: digest.mandateSnapshotHash,
      idempotencyKey: digest.idempotencyKey,
      latencyMs: digest.latencyMs,
      prevHash,
      hash,
      createdAt,
    },
  })

  return { seq, hash }
}
