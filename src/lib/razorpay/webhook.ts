/**
 * Real Razorpay webhook signature verification.
 *
 * HMAC-SHA256 over the RAW request body using RAZORPAY_WEBHOOK_SECRET, compared
 * in constant time against the x-razorpay-signature header.
 *
 * The route MUST read the raw body — a parsed-and-restringified body will not
 * match the signature. This is the classic webhook bug.
 *
 * PHASE 2
 */
export function verifyWebhookSignature(_rawBody: string, _signature: string): boolean {
  throw new Error('verifyWebhookSignature(): not implemented — Phase 2')
}
