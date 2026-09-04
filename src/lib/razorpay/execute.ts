import { prisma } from '@/lib/db'
import { razorpayClient } from './client'

/**
 * ============================================================================
 *  THE SINGLE CHOKE POINT TO MONEY.
 * ============================================================================
 *
 * This is the ONLY function in the codebase that asks Razorpay to move value.
 * It takes a persisted Decision id — not an amount, not a cart, not anything the
 * agent constructed — reloads it, and refuses to act unless the recorded verdict
 * is ALLOW.
 *
 * Why it reads the decision back from the database instead of accepting the
 * verdict as an argument: an argument can be forged by any caller. A row can
 * only have been written by the ledger, which is only written by the policy
 * engine's output. The agent cannot reach this function with a verdict it
 * invented.
 *
 * Idempotency: a Transaction row is unique per decisionId. A retry after a
 * network failure finds the existing row and returns it rather than creating a
 * second order. Combined with the engine's DUPLICATE_REQUEST check, the same
 * purchase cannot be paid for twice.
 */

export interface ExecutionResult {
  razorpayOrderId: string
  amountPaise: number
  /** true when an existing transaction was returned instead of creating a new order. */
  reused: boolean
  /** Razorpay-hosted checkout for this order, when the link was created. */
  paymentLinkUrl?: string | null
}

export async function executePayment(decisionId: string): Promise<ExecutionResult> {
  const decision = await prisma.decision.findUnique({
    where: { id: decisionId },
    include: { transaction: true },
  })

  if (!decision) throw new Error(`executePayment: no decision ${decisionId}`)

  // The gate. Nothing below this line runs for a BLOCK.
  if (decision.verdict !== 'ALLOW') {
    throw new Error(
      `executePayment: refusing to execute a ${decision.verdict} decision (${decisionId})`,
    )
  }

  if (decision.transaction) {
    return {
      razorpayOrderId: decision.transaction.razorpayOrderId,
      amountPaise: decision.transaction.amountPaise,
      paymentLinkUrl: decision.transaction.razorpayPaymentLinkUrl,
      reused: true,
    }
  }

  // The RESOLVED fields, which sit at the top level and came from the catalog.
  // `requestedAction.claimed` holds whatever the agent said it was buying and is
  // evidence only — reading it here would hand the agent the amount again and
  // undo the whole point of resolving it.
  const requested = JSON.parse(decision.requestedAction) as {
    merchantId: string
    itemId: string
    amountPaise: number
  }

  const order = await razorpayClient().orders.create({
    amount: requested.amountPaise, // already paise — our invariant matches Razorpay's unit
    currency: 'INR',
    // Razorpay caps receipt at 40 chars, so the 64-char decision hash is truncated.
    receipt: `mg_${decision.hash.slice(0, 32)}`,
    notes: {
      mandateId: decision.mandateId,
      decisionSeq: String(decision.seq),
      merchantId: requested.merchantId,
      itemId: requested.itemId,
    },
  })

  // A Payment Link alongside the order, so the authorization can actually be
  // paid rather than only recorded. `reference_id` is the order id, which is how
  // the webhook maps a payment_link.paid event back to this transaction.
  //
  // THE ORDER STANDS IF THIS FAILS. An authorized purchase whose link call
  // errored is still an authorized purchase, and throwing here would turn a
  // Razorpay hiccup into a policy failure on stage.
  let paymentLinkId: string | null = null
  let paymentLinkUrl: string | null = null

  try {
    // The SDK's typings mark `customer` as required on the create body. The API
    // does not: a link with notifications switched off needs nobody to notify,
    // and inventing a name, email and phone to satisfy a type would put
    // fabricated personal data on a real Razorpay object. So the call is exactly
    // what the API wants and the over-strict type is cast past, once, here.
    const params = {
      amount: requested.amountPaise,
      currency: 'INR',
      reference_id: order.id,
      description: `${requested.itemId} from ${requested.merchantId}`,
      notes: {
        mandateId: decision.mandateId,
        decisionSeq: String(decision.seq),
        itemId: requested.itemId,
        merchantId: requested.merchantId,
      },
      notify: { sms: false, email: false },
      reminder_enable: false,
    }

    const link = await razorpayClient().paymentLink.create(
      params as unknown as Parameters<ReturnType<typeof razorpayClient>['paymentLink']['create']>[0],
    )
    paymentLinkId = link.id
    paymentLinkUrl = link.short_url
  } catch (err) {
    console.warn(
      `[reins] payment link creation failed for order ${order.id}; the order stands.`,
      err instanceof Error ? err.message : err,
    )
  }

  await prisma.transaction.create({
    data: {
      decisionId: decision.id,
      razorpayOrderId: order.id,
      razorpayPaymentLinkId: paymentLinkId,
      razorpayPaymentLinkUrl: paymentLinkUrl,
      amountPaise: requested.amountPaise,
      status: 'CREATED',
    },
  })

  return {
    razorpayOrderId: order.id,
    amountPaise: requested.amountPaise,
    paymentLinkUrl,
    reused: false,
  }
}
