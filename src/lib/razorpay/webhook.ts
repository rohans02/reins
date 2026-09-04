import { createHmac, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/db'

/**
 * Razorpay webhook signature verification and event handling.
 *
 * Razorpay signs the RAW request body with HMAC-SHA256 keyed by the webhook
 * secret and sends the hex digest in `x-razorpay-signature`. The route MUST pass
 * the raw body string: a parsed-then-restringified body will not match, because
 * key order and whitespace change. That is the classic webhook bug.
 */

export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not set (see .env.example)')
  if (!signature) return false

  const expected = Buffer.from(
    createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex'),
    'utf8',
  )
  const actual = Buffer.from(signature, 'utf8')

  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

/** The subset of Razorpay's event payload this prototype consumes. */
export interface RazorpayWebhookEvent {
  event: string
  payload: {
    payment?: { entity: { id: string; order_id: string; status: string } }
    order?: { entity: { id: string; status: string } }
    payment_link?: { entity: { id: string; reference_id?: string | null; status: string } }
  }
}

/**
 * Applies a verified event to the spend ledger.
 *
 * Deliberately separate from the route handler so scripts and tests can drive
 * the full path without standing up an HTTP server.
 *
 * Unknown event types are ignored rather than treated as errors — Razorpay will
 * happily send events we never subscribed to, and a 500 makes it retry forever.
 */
export async function handleWebhookEvent(
  event: RazorpayWebhookEvent,
): Promise<{ applied: boolean; reason: string }> {
  const HANDLED = ['payment.captured', 'order.paid', 'payment_link.paid']
  if (!HANDLED.includes(event.event)) {
    return { applied: false, reason: `ignored event ${event.event}` }
  }

  // payment_link.paid carries the order id in `reference_id`, which is what
  // execute.ts set when it created the link. The nested payment entity is the
  // fallback, since Razorpay includes it on most link payloads too.
  const orderId =
    event.payload.payment?.entity.order_id ??
    event.payload.order?.entity.id ??
    event.payload.payment_link?.entity.reference_id ??
    null
  const paymentId = event.payload.payment?.entity.id ?? null
  if (!orderId) return { applied: false, reason: 'event carried no order id' }

  const txn = await prisma.transaction.findFirst({ where: { razorpayOrderId: orderId } })
  if (!txn) return { applied: false, reason: `no transaction for order ${orderId}` }

  // Idempotent: Razorpay retries webhooks, and a second delivery must not
  // double-count the spend.
  if (txn.status === 'PAID') return { applied: false, reason: 'already applied' }

  await prisma.$transaction([
    prisma.transaction.update({
      where: { id: txn.id },
      data: { status: 'PAID', razorpayPaymentId: paymentId },
    }),
    prisma.mandate.update({
      where: { id: (await mandateIdForTransaction(txn.decisionId)) },
      data: { spentPaise: { increment: txn.amountPaise } },
    }),
  ])

  return { applied: true, reason: `spend ledger credited ${txn.amountPaise} paise` }
}

async function mandateIdForTransaction(decisionId: string): Promise<string> {
  const decision = await prisma.decision.findUniqueOrThrow({
    where: { id: decisionId },
    select: { mandateId: true },
  })
  return decision.mandateId
}
