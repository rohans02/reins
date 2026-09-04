import { describe, expect, it } from 'vitest'
import { explainDecision } from './explain'
import { REASON_CODES } from './reason-codes'
import type { MandateRules } from '@/lib/mandate/schema'

/**
 * One case per reason code, plus the compound case the demo actually produces.
 */

const RULES: MandateRules = {
  merchants: ['bigbasket', 'zepto'],
  categories: ['groceries'],
  perTxnCapPaise: 80_000,
  totalCapPaise: 300_000,
  maxTxnsPerHour: 10,
  expiresAt: '2030-12-31T00:00:00.000Z',
}

function explain(codes: string[], over: Partial<Parameters<typeof explainDecision>[0]> = {}) {
  return explainDecision({
    verdict: 'BLOCK',
    reasonCodes: codes,
    amountPaise: 499_900,
    rules: RULES,
    merchantId: 'luxe-store',
    spentPaise: 66_300,
    ...over,
  })
}

describe('explainDecision', () => {
  it('says nothing about an allowed purchase', () => {
    expect(explainDecision({
      verdict: 'ALLOW',
      reasonCodes: [],
      amountPaise: 28_500,
      rules: RULES,
      merchantId: 'bigbasket',
      spentPaise: 0,
    })).toBe('')
  })

  it('names the per-order cap and the amount', () => {
    expect(explain([REASON_CODES.PER_TXN_CAP_EXCEEDED])).toBe(
      '₹4,999.00 is over the ₹800.00 per-order cap.',
    )
  })

  it('states what is left rather than what was asked for', () => {
    expect(explain([REASON_CODES.TOTAL_CAP_EXCEEDED])).toBe('Only ₹2,337.00 is left on the mandate.')
  })

  it('names the merchant', () => {
    expect(explain([REASON_CODES.MERCHANT_NOT_ALLOWLISTED])).toBe(
      'luxe-store is not an allowed merchant.',
    )
  })

  it('covers category, velocity, status, signature, replay and unknown items', () => {
    expect(explain([REASON_CODES.CATEGORY_NOT_ALLOWED])).toBe('The category is not permitted.')
    expect(explain([REASON_CODES.VELOCITY_LIMIT_EXCEEDED])).toBe(
      'The limit of 10 orders an hour is used up.',
    )
    expect(explain([REASON_CODES.MANDATE_REVOKED])).toBe('The mandate was revoked.')
    expect(explain([REASON_CODES.MANDATE_EXPIRED])).toBe('The mandate has expired.')
    expect(explain([REASON_CODES.MANDATE_NOT_ACTIVE])).toBe('The mandate is not active.')
    expect(explain([REASON_CODES.SIGNATURE_INVALID])).toBe(
      'The mandate signature does not verify.',
    )
    expect(explain([REASON_CODES.DUPLICATE_REQUEST])).toBe('This request was already seen.')
    expect(explain([REASON_CODES.ITEM_UNKNOWN])).toBe('That item is not in the catalog.')
  })

  it('covers every code in a compound refusal, not just the first', () => {
    const sentence = explain([
      REASON_CODES.MERCHANT_NOT_ALLOWLISTED,
      REASON_CODES.CATEGORY_NOT_ALLOWED,
      REASON_CODES.PER_TXN_CAP_EXCEEDED,
      REASON_CODES.TOTAL_CAP_EXCEEDED,
    ])

    expect(sentence).toContain('₹800.00 per-order cap')
    expect(sentence).toContain('left on the mandate')
    expect(sentence).toContain('luxe-store is not an allowed merchant')
    expect(sentence).toContain('the category is not permitted')
    expect(sentence.split(' ').length).toBeLessThan(35)
  })

  it('never returns an empty string for a refusal', () => {
    expect(explain([])).toBe('Refused by the policy engine.')
  })
})
