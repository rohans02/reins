// GET /api/catalog — seed catalog for the UI. AI: no. Razorpay: no. Phase 3.
export async function GET() {
  return Response.json({ error: "not_implemented", phase: 3 }, { status: 501 })
}
