/**
 * The buyer agent loop. Hand-written on purpose (~60 lines) — not LangGraph
 * (Python-first, wrong stack) and not the SDK toolRunner, because a loop you can
 * walk a judge through line by line is the stronger hiring signal.
 *
 * Model:    claude-opus-5
 * Thinking: { type: 'adaptive' }
 * Effort:   output_config.effort = 'low'  (latency-sensitive live demo)
 * Streaming: yes — every turn is piped to the UI over SSE.
 *
 * GUARDRAILS ON THE AGENT ITSELF (not just on the money):
 *   - hard cap of 12 turns
 *   - hard wall-clock cap of 90s
 * Mention both at panel: it shows you thought about runaway loops, not only overspend.
 *
 * Parallel tool_use blocks must return ALL tool_results in a SINGLE user message.
 * Always JSON.parse() tool inputs; never string-match the serialized input.
 *
 * PHASE 2
 */
export const MAX_TURNS = 12
export const MAX_WALL_CLOCK_MS = 90_000

export async function* runAgent(_opts: { mandateId: string; task: string }): AsyncGenerator<unknown> {
  throw new Error('runAgent(): not implemented — Phase 2')
}
