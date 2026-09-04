import { createHmac, timingSafeEqual } from 'node:crypto'
import { canonical } from './canonical'
import type { MandateRules } from './schema'

/**
 * HMAC-SHA256 over canonical(rules), keyed by MANDATE_SIGNING_KEY.
 */
function signingKey(): string {
  const key = process.env.MANDATE_SIGNING_KEY
  if (!key) throw new Error('MANDATE_SIGNING_KEY is not set (see .env.example)')
  return key
}

export function signMandate(rules: MandateRules): string {
  return createHmac('sha256', signingKey()).update(canonical(rules), 'utf8').digest('hex')
}

/**
 * Constant-time comparison. Returns false for any tampering, including a
 * reordered allowlist that changes meaning, because canonical() sorts keys but
 * preserves array order.
 */
export function verifyMandate(rules: MandateRules, signature: string): boolean {
  const expected = Buffer.from(signMandate(rules), 'utf8')
  const actual = Buffer.from(signature ?? '', 'utf8')
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}
