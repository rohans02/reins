import Anthropic from '@anthropic-ai/sdk'
import { MANDATE_DRAFTER_SYSTEM_PROMPT } from '@/lib/agent/prompts'
import { prisma } from '@/lib/db'

/**
 * POST /api/mandates/draft — plain-language intent to a structured mandate draft.
 * AI: yes. Razorpay: no.
 *
 * The model PROPOSES only. Nothing here is signed and nothing becomes active;
 * the response is a draft a human edits and approves at POST /api/mandates.
 *
 * With no API key this returns 503 rather than faking a parse. The Mandate
 * Studio falls back to a manually-filled form, so the product still works — it
 * just does not pretend an LLM was involved when one was not.
 */
export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ai_unavailable', message: 'ANTHROPIC_API_KEY is not set — fill the mandate in manually.' },
      { status: 503 },
    )
  }

  const { intent } = (await request.json()) as { intent?: string }
  if (!intent) return Response.json({ error: 'intent is required' }, { status: 400 })

  const merchants = await prisma.merchant.findMany()
  const known = merchants.map((m) => `${m.id} (${m.name}, ${m.category})`).join('; ')

  const client = new Anthropic()
  const res = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16_000,
    system: MANDATE_DRAFTER_SYSTEM_PROMPT,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            merchants: { type: 'array', items: { type: 'string' } },
            categories: { type: 'array', items: { type: 'string' } },
            perTxnCapPaise: { type: 'integer' },
            totalCapPaise: { type: 'integer' },
            maxTxnsPerHour: { type: 'integer' },
            expiresAt: { type: 'string' },
          },
          required: ['merchants', 'categories', 'perTxnCapPaise', 'totalCapPaise', 'maxTxnsPerHour', 'expiresAt'],
        },
      },
    },
    messages: [
      {
        role: 'user',
        content: `Known merchants: ${known}\nToday is ${new Date().toISOString()}.\n\nIntent: ${intent}`,
      },
    ],
  })

  const text = res.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') {
    return Response.json({ error: 'no_draft_returned' }, { status: 502 })
  }

  return Response.json({ rules: JSON.parse(text.text) as unknown })
}
