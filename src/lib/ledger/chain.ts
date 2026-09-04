import { canonicalHash } from '@/lib/mandate/canonical'

/**
 * The pure half of the audit ledger: how a row's hash is computed.
 */

/** prevHash of the very first row. */
export const GENESIS_HASH = '0'.repeat(64)

/**
 * Exactly the fields covered by the chain.
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
  /** Microseconds. */
  latencyUs: number
  /** ISO-8601. Set explicitly by the writer, never left to a DB default. */
  createdAt: string
}

export function computeRowHash(prevHash: string, digest: LedgerDigest): string {
  return canonicalHash({ prevHash, ...digest })
}
