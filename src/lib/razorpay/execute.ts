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
      reused: true,
    }
  }

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
