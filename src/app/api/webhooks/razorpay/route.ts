import { handleWebhookEvent, verifyWebhookSignature, type RazorpayWebhookEvent } from '@/lib/razorpay/webhook'

/**
 * POST /api/webhooks/razorpay — payment confirmations.
 * AI: no. Razorpay: yes, with real HMAC verification.
 *
 * The raw body is read FIRST and never re-serialized. Razorpay signs the exact
 * bytes it sent; parsing and re-stringifying changes key order and whitespace
 * and breaks the signature.
 *
 * An invalid signature returns 400 and is not retried. A genuine processing
 * failure returns 500 so Razorpay retries. Getting these the wrong way round
 * either drops real events or spins a forged one forever.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature')

  if (!verifyWebhookSignature(rawBody, signature)) {
    return Response.json({ error: 'invalid_signature' }, { status: 400 })
  }

  let event: RazorpayWebhookEvent
  try {
    event = JSON.parse(rawBody) as RazorpayWebhookEvent
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const result = await handleWebhookEvent(event)
  return Response.json(result, { status: 200 })
}
