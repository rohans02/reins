// POST /api/mandates — canonicalise, HMAC-sign, activate. AI: no. Razorpay: no.
// This is the only place a mandate becomes ACTIVE, and only after human review. Phase 3.
export async function POST() {
  return Response.json({ error: "not_implemented", phase: 3 }, { status: 501 })
}
