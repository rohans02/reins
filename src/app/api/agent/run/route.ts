// POST /api/agent/run — starts the buyer agent, returns an SSE stream.
// AI: YES (the agent loop). Razorpay: indirectly, via the policy engine on ALLOW.
// Emits: token | tool_call | decision | done. Phase 2 (engine) + Phase 3 (stream to UI).
export async function POST() {
  return Response.json({ error: "not_implemented", phase: 2 }, { status: 501 })
}
