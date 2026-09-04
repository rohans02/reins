import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { canonical } from '@/lib/mandate/canonical'
import { signMandate } from '@/lib/mandate/sign'
import type { MandateRules } from '@/lib/mandate/schema'
import { authorizeAndExecute } from '@/lib/authorize'
import { DEFAULT_USER_ID } from '@/lib/auth/users'

/**
 * THE RELABELLING TEST.
 *
 * The 68-case adversarial suite calls `evaluate()` directly, so it can only ever
 * prove that the engine judges correctly once it has been told what the action
 * is. It structurally cannot catch the hole this file exists for: an agent that
 * lies about WHICH thing it is buying. That lie is resolved away in
 * `authorizeAndExecute`, one layer above the engine, so it has to be tested one
 * layer above the engine too.
 *
 * This runs against the real SQLite file and the real catalog rows, because a
 * mocked catalog would test the mock. Only the Razorpay call is stubbed, since
 * this is about authorization and not about payment.
 */

const RULES: MandateRules = {
  merchants: ['bigbasket', 'zepto'],
  categories: ['groceries'],
  perTxnCapPaise: 80_000,
  totalCapPaise: 300_000,
  maxTxnsPerHour: 20,
  expiresAt: '2030-12-31T00:00:00.000Z',
}

/** Stands in for Razorpay. Authorization is what is under test. */
const noPayment = async () => ({ razorpayOrderId: 'order_stubbed' })

let mandateId: string

beforeAll(async () => {
  const mandate = await prisma.mandate.create({
    data: {
      userId: DEFAULT_USER_ID,
      status: 'ACTIVE',
      intentText: 'authorize.test.ts fixture',
      rules: canonical(RULES),
      signature: signMandate(RULES),
      totalCapPaise: RULES.totalCapPaise,
      expiresAt: new Date(RULES.expiresAt),
      signedAt: new Date(),
    },
  })
  mandateId = mandate.id
})

afterAll(async () => {
  // Revoked rather than deleted: the ledger is append-only, so the decisions
  // this file wrote must stay and stay linked to a real mandate.
  await prisma.mandate.update({ where: { id: mandateId }, data: { status: 'REVOKED' } })
  await prisma.$disconnect()
})

describe('authorizeAndExecute resolves the item from the catalog', () => {
  it('refuses a Luxe watch relabelled as a one-rupee BigBasket grocery', async () => {
    const result = await authorizeAndExecute({
      mandateId,
      actorUserId: DEFAULT_USER_ID,
      action: {
        merchantId: 'bigbasket',
        itemId: 'lx-watch-1',
        category: 'groceries',
        amountPaise: 100,
      },
      requestId: 'relabelled-watch',
      execute: noPayment,
    })

    expect(result.verdict).toBe('BLOCK')
    expect(result.reasonCodes).toContain('MERCHANT_NOT_ALLOWLISTED')
    expect(result.reasonCodes).toContain('CATEGORY_NOT_ALLOWED')
    expect(result.reasonCodes).toContain('PER_TXN_CAP_EXCEEDED')
    expect(result.razorpayOrderId).toBeUndefined()
  })

  it('judges a real grocery on its catalog price, not the claimed one', async () => {
    const result = await authorizeAndExecute({
      mandateId,
      actorUserId: DEFAULT_USER_ID,
      action: {
        merchantId: 'bigbasket',
        itemId: 'bb-rice-10',
        category: 'groceries',
        amountPaise: 1,
      },
      requestId: 'underpriced-rice',
      execute: noPayment,
    })

    // bb-rice-10 is a genuine bigbasket grocery, so merchant and category pass.
    // Only its real price breaks the per-order cap.
    expect(result.verdict).toBe('BLOCK')
    expect(result.reasonCodes).toContain('PER_TXN_CAP_EXCEEDED')
    expect(result.reasonCodes).not.toContain('MERCHANT_NOT_ALLOWLISTED')
    expect(result.reasonCodes).not.toContain('CATEGORY_NOT_ALLOWED')
  })

  it('refuses an item that is not in the catalog at all', async () => {
    const result = await authorizeAndExecute({
      mandateId,
      actorUserId: DEFAULT_USER_ID,
      action: {
        merchantId: 'bigbasket',
        itemId: 'not-a-real-item',
        category: 'groceries',
        amountPaise: 100,
      },
      requestId: 'unknown-item',
      execute: noPayment,
    })

    expect(result.verdict).toBe('BLOCK')
    expect(result.reasonCodes).toEqual(['ITEM_UNKNOWN'])
    // The engine was never consulted, so there are no checks to report.
    expect(result.checks).toEqual([])
  })

  it('marks an expired mandate EXPIRED instead of leaving it ACTIVE', async () => {
    // EXPIRED was in the status vocabulary with nothing ever writing it, so an
    // expired mandate kept claiming ACTIVE while the engine refused everything.
    const expiredRules: MandateRules = { ...RULES, expiresAt: '2020-01-01T00:00:00.000Z' }
    const expired = await prisma.mandate.create({
      data: {
        userId: DEFAULT_USER_ID,
        status: 'ACTIVE',
        intentText: 'expiry fixture',
        rules: canonical(expiredRules),
        signature: signMandate(expiredRules),
        totalCapPaise: expiredRules.totalCapPaise,
        expiresAt: new Date(expiredRules.expiresAt),
        signedAt: new Date(),
      },
    })

    const result = await authorizeAndExecute({
      mandateId: expired.id,
      actorUserId: DEFAULT_USER_ID,
      action: {
        merchantId: 'bigbasket',
        itemId: 'bb-atta-5',
        category: 'groceries',
        amountPaise: 28_500,
      },
      requestId: 'expired-attempt',
      execute: noPayment,
    })

    expect(result.verdict).toBe('BLOCK')
    expect(result.reasonCodes).toContain('MANDATE_EXPIRED')

    const after = await prisma.mandate.findUniqueOrThrow({ where: { id: expired.id } })
    expect(after.status).toBe('EXPIRED')
  })

  it('allows an honest purchase and executes it at the catalog price', async () => {
    let executedFor: string | null = null
    const result = await authorizeAndExecute({
      mandateId,
      actorUserId: DEFAULT_USER_ID,
      action: {
        merchantId: 'bigbasket',
        itemId: 'bb-atta-5',
        category: 'groceries',
        amountPaise: 28_500,
      },
      requestId: 'honest-atta',
      execute: async (decisionId) => {
        executedFor = decisionId
        return { razorpayOrderId: 'order_stubbed' }
      },
    })

    expect(result.verdict).toBe('ALLOW')
    expect(result.reasonCodes).toEqual([])
    expect(executedFor).toBe(result.decisionId)

    const row = await prisma.decision.findUniqueOrThrow({ where: { seq: result.seq } })
    const recorded = JSON.parse(row.requestedAction) as { amountPaise: number }
    expect(recorded.amountPaise).toBe(28_500)
  })

  it('records what the agent claimed, without judging it', async () => {
    const result = await authorizeAndExecute({
      mandateId,
      actorUserId: DEFAULT_USER_ID,
      action: {
        merchantId: 'bigbasket',
        itemId: 'lx-watch-1',
        category: 'groceries',
        amountPaise: 100,
      },
      requestId: 'claimed-evidence',
      execute: noPayment,
    })

    const row = await prisma.decision.findUniqueOrThrow({ where: { seq: result.seq } })
    const recorded = JSON.parse(row.requestedAction) as {
      merchantId: string
      category: string
      amountPaise: number
      claimed: { merchantId: string; category: string; amountPaise: number }
    }

    // Resolved at the top level, the agent's version preserved beneath it.
    expect(recorded.merchantId).toBe('luxe-store')
    expect(recorded.category).toBe('fashion')
    expect(recorded.amountPaise).toBe(499_900)
    expect(recorded.claimed.merchantId).toBe('bigbasket')
    expect(recorded.claimed.category).toBe('groceries')
    expect(recorded.claimed.amountPaise).toBe(100)
  })
})
