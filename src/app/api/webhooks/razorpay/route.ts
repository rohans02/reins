// POST /api/webhooks/razorpay — payment confirmations. AI: no. Razorpay: YES (real HMAC).
//
// MUST read the RAW body (await request.text()) before any parsing. A parsed-and-
// restringified body will not match x-razorpay-signature. This is the classic bug.
// Phase 2.
export async function POST(request: Request) {
  const _rawBody = await request.text()
  return Response.json({ error: "not_implemented", phase: 2 }, { status: 501 })
}
