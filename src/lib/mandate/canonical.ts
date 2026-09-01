import { createHash } from 'node:crypto'

/**
 * Deterministic JSON canonicalisation. EVERYTHING hashes through this function:
 * mandate signatures, ledger row hashes, and idempotency keys.
 *
 * If this is non-deterministic, signatures break, the hash chain breaks, and the
 * audit trail is worthless.
 *
 * Rules:
 *   - object keys sorted (UTF-16 code-unit order, the JS default — stable everywhere)
 *   - no whitespace
 *   - `undefined` properties dropped (they are absent, not null)
 *   - arrays keep their order (arrays are ordered data, not sets)
 *   - Dates serialise as ISO-8601 strings
 *   - NaN / Infinity rejected rather than silently becoming null, which is what
 *     JSON.stringify does and is exactly how a hash chain silently diverges
 */
export function canonical(value: unknown): string {
  return serialize(value)
}

function serialize(v: unknown): string {
  if (v === null) return 'null'

  const t = typeof v

  if (t === 'number') {
    if (!Number.isFinite(v as number)) {
      throw new Error(`canonical(): refusing to serialize non-finite number ${String(v)}`)
    }
    return JSON.stringify(v)
  }

  if (t === 'string' || t === 'boolean') return JSON.stringify(v)

  if (t === 'bigint') throw new Error('canonical(): bigint is not serializable')
  if (t === 'function' || t === 'symbol' || t === 'undefined') {
    throw new Error(`canonical(): ${t} is not serializable`)
  }

  if (Array.isArray(v)) return `[${v.map(serialize).join(',')}]`

  if (v instanceof Date) return JSON.stringify(v.toISOString())

  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()

  return `{${keys.map((k) => `${JSON.stringify(k)}:${serialize(obj[k])}`).join(',')}}`
}

/** sha256 hex of the canonical form. Used by the ledger chain and mandate snapshots. */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex')
}
