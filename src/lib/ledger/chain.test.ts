import { describe, expect, it } from 'vitest'
import { GENESIS_HASH, computeRowHash, type LedgerDigest } from './chain'

/**
 * Hermetic tests for the tamper-evidence primitive. No database: these prove the
 * property the "Chain verified" badge depends on. The DB-backed walk in
 * verify.ts is exercised end-to-end in Phase 2.
 */

function digest(overrides: Partial<LedgerDigest> = {}): LedgerDigest {
  return {
    seq: 1,
    mandateId: 'mandate-1',
    agentRunId: null,
    action: 'PURCHASE',
    requestedAction: '{"amountPaise":28500,"merchantId":"bigbasket"}',
    verdict: 'ALLOW',
    reasonCodes: [],
    mandateSnapshotHash: 'a'.repeat(64),
    idempotencyKey: 'idem-1',
    latencyMs: 3,
    createdAt: '2026-09-02T10:00:00.000Z',
    ...overrides,
  }
}

describe('ledger chain', () => {
  it('is deterministic', () => {
    expect(computeRowHash(GENESIS_HASH, digest())).toBe(computeRowHash(GENESIS_HASH, digest()))
  })

  it('produces a sha256 hex digest', () => {
    expect(computeRowHash(GENESIS_HASH, digest())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes if the recorded verdict is altered', () => {
    const honest = computeRowHash(GENESIS_HASH, digest({ verdict: 'BLOCK' }))
    const forged = computeRowHash(GENESIS_HASH, digest({ verdict: 'ALLOW' }))
    expect(forged).not.toBe(honest)
  })

  it('changes if the amount is altered', () => {
    const a = computeRowHash(GENESIS_HASH, digest())
    const b = computeRowHash(
      GENESIS_HASH,
      digest({ requestedAction: '{"amountPaise":99900,"merchantId":"bigbasket"}' }),
    )
    expect(a).not.toBe(b)
  })

  it('changes if the reason codes are altered', () => {
    const blocked = computeRowHash(GENESIS_HASH, digest({ reasonCodes: ['PER_TXN_CAP_EXCEEDED'] }))
    const scrubbed = computeRowHash(GENESIS_HASH, digest({ reasonCodes: [] }))
    expect(blocked).not.toBe(scrubbed)
  })

  it('changes if the predecessor changes, so a row cannot be moved or removed', () => {
    const a = computeRowHash(GENESIS_HASH, digest({ seq: 2 }))
    const b = computeRowHash('b'.repeat(64), digest({ seq: 2 }))
    expect(a).not.toBe(b)
  })

  it('detects tampering anywhere in a chain, including the middle', () => {
    // Build an honest 3-row chain whose middle row records a BLOCK.
    const rows = [
      digest({ seq: 1 }),
      digest({ seq: 2, verdict: 'BLOCK', reasonCodes: ['PER_TXN_CAP_EXCEEDED'] }),
      digest({ seq: 3 }),
    ]
    const hashes: string[] = []
    let prev = GENESIS_HASH
    for (const row of rows) {
      prev = computeRowHash(prev, row)
      hashes.push(prev)
    }

    // Someone rewrites row 2 to hide a block.
    const tampered = digest({ seq: 2, verdict: 'ALLOW', reasonCodes: [] })
    const recomputed = computeRowHash(hashes[0], tampered)

    expect(recomputed).not.toBe(hashes[1])
    // ...and because row 3 was chained to the ORIGINAL row-2 hash, the break
    // also propagates forward — you cannot repair it by editing one row.
    expect(computeRowHash(recomputed, rows[2])).not.toBe(hashes[2])
  })
})
