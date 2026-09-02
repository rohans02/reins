import Anthropic from '@anthropic-ai/sdk'

/**
 * The model seam.
 *
 * The agent loop never constructs an Anthropic client. It is handed a
 * ModelClient, which has two implementations:
 *
 *   anthropicModel()  the real thing — claude-opus-5, adaptive thinking
 *   scriptedModel()   canned turns, no network, no API key
 *
 * One seam, three jobs:
 *   1. The loop can be built and run before an API key exists.
 *   2. Tests get determinism the real API can never give — the loop's control
 *      flow is asserted exactly, without paying tokens or flaking.
 *   3. It IS the DEMO_MODE=scripted fallback. On camera the agent's *choices*
 *      are fixed while the policy engine still genuinely evaluates and blocks —
 *      the guardrail is real, only the shopping is rehearsed.
 *
 * What it deliberately cannot tell us: whether the real model behaves sensibly
 * given these prompts — whether it re-plans after a BLOCK, whether it takes the
 * injection bait. That needs a live key and prompt iteration, and no mock
 * substitutes for it.
 */

export interface ToolUse {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ModelTurn {
  /** Visible prose from this turn, joined. */
  text: string
  toolUses: ToolUse[]
  stopReason: 'tool_use' | 'end_turn' | 'max_tokens' | 'other'
  /**
   * Exactly what to append to `messages` as the assistant turn. Carried through
   * verbatim rather than reconstructed, because thinking blocks must be echoed
   * back unchanged on the same model.
   */
  assistantContent: Anthropic.ContentBlockParam[]
}

export interface ModelRequest {
  system: string
  messages: Anthropic.MessageParam[]
  tools: Anthropic.Tool[]
}

export interface ModelClient {
  readonly name: string
  next(request: ModelRequest): Promise<ModelTurn>
}

// ---------------------------------------------------------------------------
// Real client
// ---------------------------------------------------------------------------

export const AGENT_MODEL = 'claude-opus-5'

export function anthropicModel(): ModelClient {
  const client = new Anthropic() // reads ANTHROPIC_API_KEY

  return {
    name: AGENT_MODEL,
    async next({ system, messages, tools }) {
      const res = await client.messages.create({
        model: AGENT_MODEL,
        max_tokens: 16_000,
        system,
        messages,
        tools,
        thinking: { type: 'adaptive' },
        // This is basket assembly over a 12-item catalog, not a reasoning
        // problem, and the demo is latency-sensitive. Raise if the agent starts
        // making poor substitutions.
        output_config: { effort: 'low' },
      })

      const toolUses: ToolUse[] = []
      let text = ''

      for (const block of res.content) {
        if (block.type === 'text') text += block.text
        // Always JSON-parse tool inputs; never string-match the serialized form.
        else if (block.type === 'tool_use') {
          toolUses.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          })
        }
      }

      return {
        text,
        toolUses,
        stopReason: normalizeStopReason(res.stop_reason),
        assistantContent: res.content as unknown as Anthropic.ContentBlockParam[],
      }
    },
  }
}

function normalizeStopReason(reason: string | null): ModelTurn['stopReason'] {
  if (reason === 'tool_use' || reason === 'end_turn' || reason === 'max_tokens') return reason
  return 'other'
}

// ---------------------------------------------------------------------------
// Scripted client
// ---------------------------------------------------------------------------

export interface ScriptedTurn {
  text?: string
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>
}

/**
 * Replays a fixed sequence of turns. Running past the end of the script ends the
 * conversation cleanly rather than throwing, so a loop that stops early (because
 * the mandate was revoked, say) is not a test failure.
 */
export function scriptedModel(
  script: ScriptedTurn[],
  opts: { delayMs?: number } = {},
): ModelClient {
  let turn = 0
  // A real model takes seconds per turn. Scripted turns return instantly, which
  // makes the run finish before anyone can watch it — and leaves no window to hit
  // Revoke mid-run, which is the demo's strongest beat. This restores the pacing.
  const delayMs = opts.delayMs ?? 0

  return {
    name: 'scripted',
    async next() {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      const step: ScriptedTurn | undefined = script[turn++]

      if (!step) {
        return {
          text: '',
          toolUses: [],
          stopReason: 'end_turn',
          assistantContent: [{ type: 'text', text: '' }],
        }
      }

      const toolUses: ToolUse[] = (step.toolCalls ?? []).map((call, i) => ({
        id: `toolu_scripted_${turn}_${i}`,
        name: call.name,
        input: call.input,
      }))

      const assistantContent: Anthropic.ContentBlockParam[] = []
      if (step.text) assistantContent.push({ type: 'text', text: step.text })
      for (const use of toolUses) {
        assistantContent.push({ type: 'tool_use', id: use.id, name: use.name, input: use.input })
      }
      if (assistantContent.length === 0) assistantContent.push({ type: 'text', text: '' })

      return {
        text: step.text ?? '',
        toolUses,
        stopReason: toolUses.length > 0 ? 'tool_use' : 'end_turn',
        assistantContent,
      }
    },
  }
}
