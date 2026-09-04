import { createHmac } from 'node:crypto'
import type { RazorpayWebhookEvent } from './webhook'

/**
 * Payment simulator. The event is synthetic; the signature and verification are real.
 */

export function buildPaymentCapturedEvent(
  razorpayOrderId: string,
  paymentId = `pay_sim_${Math.random().toString(36).slice(2, 12)}`,
): RazorpayWebhookEvent {
  return {
    event: 'payment.captured',
    payload: {
      payment: { entity: { id: paymentId, order_id: razorpayOrderId, status: 'captured' } },
    },
  }
}

/** Signs a payload the way Razorpay would: HMAC-SHA256 hex over the raw JSON body. */
export function signEvent(event: RazorpayWebhookEvent): { rawBody: string; signature: string } {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not set (see .env.example)')

  // Sign the exact bytes that will be transmitted — never a re-serialized copy.
  const rawBody = JSON.stringify(event)
  const signature = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  return { rawBody, signature }
}

/**
 * Delivers a signed event over real HTTP to the running app, so the full route
 * — raw body read, signature check, ledger update — is exercised end to end.
 */
export async function deliverPaymentCaptured(
  razorpayOrderId: string,
  appUrl = process.env.APP_URL ?? 'http://localhost:3000',
): Promise<{ status: number; body: string }> {
  const event = buildPaymentCapturedEvent(razorpayOrderId)
  const { rawBody, signature } = signEvent(event)

  const res = await fetch(`${appUrl}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature },
    body: rawBody,
  })

  return { status: res.status, body: await res.text() }
}
