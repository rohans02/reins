import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import { MANDATE_DRAFTER_SYSTEM_PROMPT } from '@/lib/agent/prompts'
import { selectProvider } from '@/lib/agent/select'
import { geminiApiKey, geminiLocation, geminiModelId, geminiVertexProject } from '@/lib/agent/gemini'
import { prisma } from '@/lib/db'
import { currentUserId } from '@/lib/auth/session'

/**
 * POST /api/mandates/draft — plain-language intent to a structured mandate draft.
 * AI: yes. Razorpay: no.
 *
 * The model PROPOSES only. Nothing here is signed and nothing becomes active.
 * The response is a draft a human edits and approves at POST /api/mandates.
 *
 * With no usable key this returns 503 rather than faking a parse. The Mandate
 * Studio falls back to a manually filled form, so the product still works. It
 * just does not pretend a model was involved when one was not.
 */

const MANDATE_SCHEMA = {
  type: 'object',
  properties: {
    merchants: { type: 'array', items: { type: 'string' } },
    categories: { type: 'array', items: { type: 'string' } },
    perTxnCapPaise: { type: 'integer' },
    totalCapPaise: { type: 'integer' },
    maxTxnsPerHour: { type: 'integer' },
    expiresAt: { type: 'string' },
  },
  required: [
    'merchants',
    'categories',
    'perTxnCapPaise',
    'totalCapPaise',
    'maxTxnsPerHour',
    'expiresAt',
  ],
} as const

export async function POST(request: Request) {
  // Guarded BEFORE the provider is chosen, because this is the one endpoint that
  // spends money on someone else's behalf: an unauthenticated caller reaching it
  // burns the operator's model credits, one request at a time, with nothing in
  // the product to show for it.
  if (!(await currentUserId())) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const provider = selectProvider()

  if (provider === 'scripted') {
    return Response.json(
      {
        error: 'ai_unavailable',
        message: 'No model API key is configured — fill the mandate in manually.',
      },
      { status: 503 },
    )
  }

  const { intent } = (await request.json()) as { intent?: string }
  if (!intent) return Response.json({ error: 'intent is required' }, { status: 400 })

  const merchants = await prisma.merchant.findMany()
  const known = merchants.map((m) => `${m.id} (${m.name}, ${m.category})`).join('; ')
  const userPrompt = `Known merchants: ${known}\nToday is ${new Date().toISOString()}.\n\nIntent: ${intent}`

  try {
    const json =
      provider === 'gemini'
        ? await draftWithGemini(userPrompt)
        : await draftWithAnthropic(userPrompt)

    return Response.json({ rules: JSON.parse(json) as unknown })
  } catch (err) {
    return Response.json(
      { error: 'draft_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }
}

async function draftWithGemini(userPrompt: string): Promise<string> {
  const apiKey = geminiApiKey()
  const ai = apiKey
    ? new GoogleGenAI({ apiKey })
    : new GoogleGenAI({
        vertexai: true,
        project: geminiVertexProject(),
        location: geminiLocation(),
      })

  const res = await ai.models.generateContent({
    model: geminiModelId(),
    contents: userPrompt,
    config: {
      systemInstruction: MANDATE_DRAFTER_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseJsonSchema: MANDATE_SCHEMA,
    },
  })

  const text = res.text
  if (!text) throw new Error('Model returned no draft')
  return text
}

async function draftWithAnthropic(userPrompt: string): Promise<string> {
  const client = new Anthropic()

  const res = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16_000,
    system: MANDATE_DRAFTER_SYSTEM_PROMPT,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: MANDATE_SCHEMA },
    },
    messages: [{ role: 'user', content: userPrompt }],
  })

  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Model returned no draft')
  return block.text
}
