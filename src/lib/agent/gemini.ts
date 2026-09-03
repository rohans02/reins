import { GoogleGenAI, type Content, type Part } from '@google/genai'
import type Anthropic from '@anthropic-ai/sdk'
import type { ModelClient, ToolUse } from './model'

/**
 * Gemini implementation of the model seam.
 *
 * The agent loop speaks one message shape internally, and that shape happens to
 * be Anthropic's. Rather than refactor the loop, the scripted client and the
 * tests onto a neutral format, this adapter translates in both directions at the
 * boundary. The loop stays untouched and provider-agnostic in practice.
 *
 * Chosen over Anthropic for one reason the code cannot see: Gemini has a free
 * tier, and this is a student project on a deadline. The tradeoff is documented
 * in the README, because Razorpay's own Agent Studio runs on Claude and a judge
 * may reasonably ask.
 */

/** Free-tier friendly. Override with GEMINI_MODEL if a newer flash model exists. */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash'

export function geminiModel(): ModelClient {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set (see .env.example)')

  const model = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL
  const ai = new GoogleGenAI({ apiKey })

  return {
    name: model,
    async next({ system, messages, tools }) {
      const res = await ai.models.generateContent({
        model,
        contents: toGeminiContents(messages),
        config: {
          systemInstruction: system,
          tools: [
            {
              functionDeclarations: tools.map((t) => ({
                name: t.name,
                description: t.description,
                parametersJsonSchema: toGeminiSchema(t.input_schema),
              })),
            },
          ],
        },
      })

      const parts = res.candidates?.[0]?.content?.parts ?? []

      let text = ''
      const toolUses: ToolUse[] = []
      const assistantContent: Anthropic.ContentBlockParam[] = []

      parts.forEach((part, i) => {
        if (part.text) {
          text += part.text
          assistantContent.push({ type: 'text', text: part.text })
        }

        if (part.functionCall?.name) {
          // Gemini does not always return a call id. The loop needs a stable one
          // to pair the result back, and it feeds the idempotency key, so
          // synthesise a deterministic one when it is absent.
          const id = part.functionCall.id ?? `gemini_${res.responseId ?? 'turn'}_${i}`
          const input = (part.functionCall.args ?? {}) as Record<string, unknown>

          toolUses.push({ id, name: part.functionCall.name, input })
          assistantContent.push({
            type: 'tool_use',
            id,
            name: part.functionCall.name,
            input,
          })
        }
      })

      if (assistantContent.length === 0) assistantContent.push({ type: 'text', text: '' })

      return {
        text,
        toolUses,
        stopReason: toolUses.length > 0 ? 'tool_use' : 'end_turn',
        assistantContent,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

/**
 * Anthropic-shaped messages into Gemini `contents`.
 *
 * Gemini's functionResponse needs the function NAME, while Anthropic's
 * tool_result only carries the tool_use id. So the walk records id to name as it
 * passes each tool_use, and looks it up when the matching result arrives.
 */
export function toGeminiContents(messages: Anthropic.MessageParam[]): Content[] {
  const nameByToolUseId = new Map<string, string>()
  const contents: Content[] = []

  for (const message of messages) {
    const parts: Part[] = []

    if (typeof message.content === 'string') {
      parts.push({ text: message.content })
    } else {
      for (const block of message.content) {
        if (block.type === 'text') {
          parts.push({ text: block.text })
        } else if (block.type === 'tool_use') {
          nameByToolUseId.set(block.id, block.name)
          parts.push({
            functionCall: {
              id: block.id,
              name: block.name,
              args: block.input as Record<string, unknown>,
            },
          })
        } else if (block.type === 'tool_result') {
          const name = nameByToolUseId.get(block.tool_use_id) ?? 'unknown_tool'
          parts.push({
            functionResponse: {
              id: block.tool_use_id,
              name,
              response: { result: flattenToolResult(block.content) },
            },
          })
        }
      }
    }

    if (parts.length > 0) {
      contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts })
    }
  }

  return contents
}

/** Tool results are text in this app; Gemini wants a plain value. */
function flattenToolResult(content: Anthropic.ToolResultBlockParam['content']): string {
  if (typeof content === 'string') return content
  if (!content) return ''
  return content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
}

/**
 * Adjusts a JSON Schema written for Anthropic so Gemini accepts it.
 *
 * Two differences that matter:
 *
 *   - Anthropic's strict mode wants every property listed in `required`, so
 *     optional filters are declared `type: ['string', 'null']` and the model
 *     sends explicit nulls. Gemini does not handle union types here, so the
 *     nullable form is collapsed to the plain type and the key is dropped from
 *     `required`. The filters become genuinely optional, which is what they
 *     always meant, and the handler already treats a missing filter as no filter.
 *   - `additionalProperties` is not part of the accepted subset.
 */
export function toGeminiSchema(schema: Anthropic.Tool['input_schema']): Record<string, unknown> {
  const source = schema as {
    type?: string
    properties?: Record<string, { type?: unknown; description?: string }>
    required?: string[]
  }

  const properties: Record<string, unknown> = {}
  const stillRequired: string[] = []

  for (const [key, prop] of Object.entries(source.properties ?? {})) {
    const declared = prop.type
    const isNullable = Array.isArray(declared) && declared.includes('null')
    const plainType = Array.isArray(declared)
      ? declared.find((t) => t !== 'null')
      : declared

    properties[key] = { ...prop, type: plainType }

    if (!isNullable && source.required?.includes(key)) stillRequired.push(key)
  }

  return {
    type: 'object',
    properties,
    ...(stillRequired.length > 0 ? { required: stillRequired } : {}),
  }
}
