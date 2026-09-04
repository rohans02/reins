import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/db'
import { canonical } from '@/lib/mandate/canonical'
import { signMandate } from '@/lib/mandate/sign'
import type { MandateRules } from '@/lib/mandate/schema'
import { authorizeAndExecute } from '@/lib/authorize'
import { DEFAULT_USER_ID } from '@/lib/auth/users'
import { handleWebhookEvent } from '@/lib/razorpay/webhook'

/**
 * THE MERCHANT-BASKET SETTLEMENT TEST.
 *
 * One Payment Link covers a whole merchant basket, so `reference_id` is a GROUP
 * id and settling it has to settle every order in that group, crediting the sum
 * rather than one item's amount.
 *
 * Two separate mistakes live here, both of which shipped.
 *
 * First, paying a link makes Razorpay create its OWN order for that payment, so
 * the event carries an order id that is not ours. An earlier version preferred
 * it, looked up an order this system had never seen, answered 200 and applied
 * nothing. Nothing caught it until a real card went through a real tunnel, which
 * is the only place those two ids differ — a hand-written probe used the same id
 * for both.
 *
 * Second, one-to-one mapping is simply wrong once a link is a basket. Settling
 * only the first row would leave the rest CREATED forever and under-credit the
 * settled figure.
 *
 * These run against the real database, because the mapping is a database lookup.
 */

const RULES: MandateRules = {
  merchants: ['bigbasket'],
  categories: ['groceries'],
  perTxnCapPaise: 80_000,
  totalCapPaise: 300_000,
  maxTxnsPerHour: 20,
  expiresAt: '2030-12-31T00:00:00.000Z',
}

/** The order id WE created. Razorpay echoes this back as reference_id. */
const OUR_ORDER = 'order_test_ours'
/** A SECOND order from the same shop, in the same basket, under the same link. */
const SECOND_ORDER = 'order_test_ours_two'
/** The order Razorpay makes for the link payment itself. We have never seen it. */
const LINK_INTERNAL_ORDER = 'order_test_razorpays_own'
/** Our merchant-basket group. One link, potentially many orders. */
const GROUP_ID = 'grp_test_basket'

let mandateId: string

beforeAll(async () => {
  // Fixed order ids make the assertions readable, but they also mean a previous
  // run leaves a PAID row that `findFirst` would pick up instead of this run's.
  // Clearing them first is what keeps the suite honest on the second execution.
  await prisma.transaction.deleteMany({
    where: { razorpayOrderId: { in: [OUR_ORDER, SECOND_ORDER, LINK_INTERNAL_ORDER] } },
  })

  const mandate = await prisma.mandate.create({
    data: {
      userId: DEFAULT_USER_ID,
      status: 'ACTIVE',
      intentText: 'webhook.test.ts fixture',
      rules: canonical(RULES),
      signature: signMandate(RULES),
      totalCapPaise: RULES.totalCapPaise,
      expiresAt: new Date(RULES.expiresAt),
      signedAt: new Date(),
    },
  })
  mandateId = mandate.id

  const result = await authorizeAndExecute({
    mandateId,
    actorUserId: DEFAULT_USER_ID,
    action: {
      merchantId: 'bigbasket',
      itemId: 'bb-atta-5',
      category: 'groceries',
      amountPaise: 28_500,
    },
    requestId: 'webhook-test-purchase',
    execute: async () => ({ razorpayOrderId: OUR_ORDER }),
  })

  await prisma.transaction.create({
    data: {
      decisionId: result.decisionId,
      razorpayOrderId: OUR_ORDER,
      paymentGroupId: GROUP_ID,
      razorpayPaymentLinkId: 'plink_test',
      razorpayPaymentLinkUrl: 'https://rzp.io/rzp/test',
      amountPaise: 28_500,
      status: 'CREATED',
    },
  })

  // A second purchase from the same shop, sharing the basket and the link.
  const second = await authorizeAndExecute({
    mandateId,
    actorUserId: DEFAULT_USER_ID,
    action: {
      merchantId: 'bigbasket',
      itemId: 'bb-dal-1',
      category: 'groceries',
      amountPaise: 18_500,
    },
    requestId: 'webhook-test-purchase-2',
    execute: async () => ({ razorpayOrderId: SECOND_ORDER }),
  })

  await prisma.transaction.create({
    data: {
      decisionId: second.decisionId,
      razorpayOrderId: SECOND_ORDER,
      paymentGroupId: GROUP_ID,
      razorpayPaymentLinkId: 'plink_test',
      razorpayPaymentLinkUrl: 'https://rzp.io/rzp/test',
      amountPaise: 18_500,
      status: 'CREATED',
    },
  })
})

afterAll(async () => {
  await prisma.mandate.update({ where: { id: mandateId }, data: { status: 'REVOKED' } })
  await prisma.$disconnect()
})

describe('payment_link.paid mapping', () => {
  it('settles the whole merchant basket through the group id', async () => {
    const result = await handleWebhookEvent({
      event: 'payment_link.paid',
      payload: {
        // Razorpay's own order for the link payment. Preferring this is the bug.
        payment: {
          entity: { id: 'pay_test', order_id: LINK_INTERNAL_ORDER, status: 'captured' },
        },
        payment_link: {
          entity: { id: 'plink_test', reference_id: GROUP_ID, status: 'paid' },
        },
      },
    })

    expect(result.applied).toBe(true)

    // BOTH orders in the basket, not just the first one found.
    const paid = await prisma.transaction.findMany({ where: { paymentGroupId: GROUP_ID } })
    expect(paid).toHaveLength(2)
    expect(paid.every((t) => t.status === 'PAID')).toBe(true)

    // Credited the SUM, not one item's amount.
    const mandate = await prisma.mandate.findUniqueOrThrow({ where: { id: mandateId } })
    expect(mandate.spentPaise).toBe(28_500 + 18_500)
  })

  it('does not double-count a redelivered event', async () => {
    const again = await handleWebhookEvent({
      event: 'payment_link.paid',
      payload: {
        payment_link: { entity: { id: 'plink_test', reference_id: GROUP_ID, status: 'paid' } },
      },
    })

    expect(again.applied).toBe(false)
    const mandate = await prisma.mandate.findUniqueOrThrow({ where: { id: mandateId } })
    expect(mandate.spentPaise).toBe(28_500 + 18_500)
  })

  it('ignores an event type it does not handle', async () => {
    const result = await handleWebhookEvent({
      event: 'payment.failed',
      payload: { payment: { entity: { id: 'pay_x', order_id: OUR_ORDER, status: 'failed' } } },
    })
    expect(result.applied).toBe(false)
    expect(result.reason).toContain('ignored event')
  })
})
