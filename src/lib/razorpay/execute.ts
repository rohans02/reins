import { prisma } from '@/lib/db'
import { razorpayClient } from './client'

/**
 * The single choke point to money. Reloads the decision and refuses anything but ALLOW.
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

  // The resolved fields, from the catalog. Reading `claimed` here would hand the
  // agent control of the amount again.
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

  // NO PAYMENT LINK HERE. Links are created per MERCHANT when the run ends, in
  // `settleRun`, because nobody pays per item — you pay a shop, and the basket
  // for a shop is not known until the agent stops shopping.
  await prisma.transaction.create({
    data: {
      decisionId: decision.id,
      razorpayOrderId: order.id,
      amountPaise: requested.amountPaise,
      status: 'CREATED',
    },
  })

  return { razorpayOrderId: order.id, amountPaise: requested.amountPaise, reused: false }
}
