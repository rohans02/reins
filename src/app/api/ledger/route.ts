// GET /api/ledger — audit trail + live chain verification. AI: no. Razorpay: no.
// Deterministic by design: this screen proves nothing was hidden or altered. Phase 3.
export async function GET() {
  return Response.json({ error: "not_implemented", phase: 3 }, { status: 501 })
}
