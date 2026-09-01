// POST /api/mandates/[id]/revoke — the kill switch. AI: no. Razorpay: no.
// Must be instant and total: every subsequent evaluate() reads status and blocks. Phase 3.
export async function POST() {
  return Response.json({ error: "not_implemented", phase: 3 }, { status: 501 })
}
