// POST /api/mandates/draft — NL intent -> structured mandate draft.
// AI: YES (claude-opus-5, structured output, effort "medium"). Razorpay: no.
// The LLM only PROPOSES. Nothing is signed here. Phase 3.
export async function POST() {
  return Response.json({ error: "not_implemented", phase: 3 }, { status: 501 })
}
