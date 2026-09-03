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

/**
 * Verified against Vertex in global, us-central1 and asia-southeast1.
 * gemini-2.0-flash is no longer served — probe before changing this, because a
 * retired model id fails as a 404 that reads like a permissions problem.
 * Override per-environment with GEMINI_MODEL.
 */
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

/**
 * Two ways to reach Gemini, and they are different products:
 *
 *   AI Studio  — an API key from aistudio.google.com. Has a genuinely free tier.
 *   Vertex AI  — a GCP project plus Application Default Credentials
 *                (`gcloud auth application-default login`). Billed to the project.
 *
 * Whichever is configured wins; the API key is preferred when both are, because
 * it is the free one.
 */
export function geminiApiKey(): string | undefined {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  return key && key.length > 20 && !key.includes('...') ? key : undefined
}

export function geminiVertexProject(): string | undefined {
  const project = process.env.GOOGLE_CLOUD_PROJECT
  return project && project.length > 0 ? project : undefined
}

/**
 * Reads an env var, treating an EMPTY string as unset.
 *
 * The `??` operator only falls back on null and undefined, so an empty
 * placeholder line in .env — GEMINI_MODEL="" — silently produced an empty model
 * id and the SDK rejected the request. Empty means "not configured" everywhere
 * here, which is what anyone writing that line intends.
 */
function envOr(name: string, fallback: string): string {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value.trim() : fallback
}

/** The model id to call, honouring GEMINI_MODEL when it is actually set. */
export function geminiModelId(): string {
  return envOr('GEMINI_MODEL', DEFAULT_GEMINI_MODEL)
}

/** Vertex region. "global" routes to wherever the model is served. */
export function geminiLocation(): string {
  return envOr('GOOGLE_CLOUD_LOCATION', 'global')
}

export function geminiConfigured(): boolean {
  return Boolean(geminiApiKey() ?? geminiVertexProject())
}

export function geminiModel(): ModelClient {
  const apiKey = geminiApiKey()
  const project = geminiVertexProject()

  if (!apiKey && !project) {
    throw new Error(
      'Gemini is not configured. Set GEMINI_API_KEY (free tier, aistudio.google.com/apikey) ' +
        'or GOOGLE_CLOUD_PROJECT with `gcloud auth application-default login` for Vertex AI.',
    )
  }

  const model = geminiModelId()

  const ai = apiKey
    ? new GoogleGenAI({ apiKey })
    : new GoogleGenAI({
        vertexai: true,
        project,
        // Gemini model availability varies by region. `global` routes to
        // wherever the model is served, which is what you want unless there is
        // a data-residency reason to pin a region.
        location: geminiLocation(),
      })

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
 *
 * Both rules apply at EVERY depth. announce_plan takes an array of objects, and
 * an `additionalProperties` left behind on the nested item schema is rejected
 * just as firmly as one at the top.
 */
type JsonSchemaNode = {
  type?: unknown
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  items?: JsonSchemaNode
  additionalProperties?: unknown
  description?: string
}

export function toGeminiSchema(schema: Anthropic.Tool['input_schema']): Record<string, unknown> {
  return convert(schema as JsonSchemaNode) as Record<string, unknown>
}

function convert(node: JsonSchemaNode): Record<string, unknown> {
  // Dropped rather than translated: Gemini rejects the key outright.
  const { additionalProperties: _ignored, properties, required, items, type, ...rest } = node

  const plainType = Array.isArray(type) ? type.find((t) => t !== 'null') : type
  const out: Record<string, unknown> = { ...rest, type: plainType }

  if (properties) {
    const converted: Record<string, unknown> = {}
    const stillRequired: string[] = []

    for (const [key, prop] of Object.entries(properties)) {
      converted[key] = convert(prop)
      const nullable = Array.isArray(prop.type) && prop.type.includes('null')
      if (!nullable && required?.includes(key)) stillRequired.push(key)
    }

    out.properties = converted
    if (stillRequired.length > 0) out.required = stillRequired
  }

  if (items) out.items = convert(items)

  return out
}
