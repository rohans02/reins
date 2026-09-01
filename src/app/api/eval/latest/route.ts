// GET /api/eval/latest — latest metrics for the Trust Report. AI: no. Razorpay: no. Phase 4.
export async function GET() {
  return Response.json({ error: "not_implemented", phase: 4 }, { status: 501 })
}
