import { handleWebhookEvent, verifyWebhookSignature, type RazorpayWebhookEvent } from '@/lib/razorpay/webhook'

/**
 * POST /api/webhooks/razorpay — payment confirmations.
 * AI: no. Razorpay: yes, with real HMAC verification.
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
