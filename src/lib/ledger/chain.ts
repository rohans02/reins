import { canonicalHash } from '@/lib/mandate/canonical'

/**
 * The pure half of the audit ledger: how a row's hash is computed.
 *
 * Kept separate from append.ts so that both the writer and the verifier derive
 * hashes from ONE definition. Two copies of this logic that drift apart is how a
 * tamper-evident log quietly stops being tamper-evident.
 */

/** prevHash of the very first row. */
export const GENESIS_HASH = '0'.repeat(64)

/**
 * Exactly the fields covered by the chain.
 *
 * `explanation` is deliberately EXCLUDED. It is LLM-written prose produced after
 * the verdict, it may be null, and it is cosmetic. The chain protects the
 * decision, not the narration — so editing an explanation does not, and should
 * not, invalidate the record of what was decided.
 */
export interface LedgerDigest {
  seq: number
  mandateId: string
  agentRunId: string | null
  action: string
  /** canonical() of the requested action — a string, so it hashes stably. */
  requestedAction: string
  verdict: string
  reasonCodes: string[]
  mandateSnapshotHash: string
  idempotencyKey: string
  latencyMs: number
  /** ISO-8601. Set explicitly by the writer, never left to a DB default. */
  createdAt: string
}

export function computeRowHash(prevHash: string, digest: LedgerDigest): string {
  return canonicalHash({ prevHash, ...digest })
}
