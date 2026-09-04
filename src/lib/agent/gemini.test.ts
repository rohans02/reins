import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { toGeminiContents, toGeminiSchema } from './gemini'
import { AGENT_TOOLS, TOOL_NAMES } from './tools'

/**
 * The translation layer is where a provider swap actually breaks, and it is pure,
 * so it can be tested without a key or a single token spent. These run before the
 * live model is ever called.
 */

describe('gemini schema translation', () => {
  const searchTool = AGENT_TOOLS.find((t) => t.name === TOOL_NAMES.SEARCH_CATALOG)!
  const purchaseTool = AGENT_TOOLS.find((t) => t.name === TOOL_NAMES.REQUEST_PURCHASE)!
  const planTool = AGENT_TOOLS.find((t) => t.name === TOOL_NAMES.ANNOUNCE_PLAN)!

  // announce_plan is the only tool with a nested object schema. Translation that
  // stops at the top level makes Gemini reject the tool at call time.
  it('converts nested array-of-object schemas all the way down', () => {
    const schema = toGeminiSchema(planTool.input_schema) as {
      properties: {
        items: { type: string; items: { type: string; properties: Record<string, { type: string }>; required: string[] } }
      }
    }
    const item = schema.properties.items.items
    expect(schema.properties.items.type).toBe('array')
    expect(item.type).toBe('object')
    expect(item.properties.amountPaise.type).toBe('integer')
    expect(item.properties.merchantId.type).toBe('string')
    expect(item.required.sort()).toEqual(['amountPaise', 'itemId', 'merchantId', 'name'])
  })

  it('collapses nullable union types to a plain type', () => {
    const schema = toGeminiSchema(searchTool.input_schema) as {
      properties: Record<string, { type: string }>
    }
    // Declared as ['string','null'] for Anthropic strict mode.
    expect(schema.properties.query.type).toBe('string')
    expect(schema.properties.merchantId.type).toBe('string')
    expect(schema.properties.maxPricePaise.type).toBe('integer')
  })

  it('drops the nullable filters from required, making them genuinely optional', () => {
    const schema = toGeminiSchema(searchTool.input_schema) as { required?: string[] }
    // Every search filter was nullable, so nothing is required.
    expect(schema.required ?? []).toEqual([])
  })

  it('keeps genuinely required fields required', () => {
    const schema = toGeminiSchema(purchaseTool.input_schema) as { required: string[] }
    expect(schema.required.sort()).toEqual(
      ['amountPaise', 'category', 'itemId', 'merchantId'].sort(),
    )
  })

  it('never emits additionalProperties, which Gemini does not accept', () => {
    for (const tool of AGENT_TOOLS) {
      expect(JSON.stringify(toGeminiSchema(tool.input_schema))).not.toContain(
        'additionalProperties',
      )
    }
  })
})

describe('gemini message translation', () => {
  it('maps assistant to model and user to user', () => {
    const contents = toGeminiContents([
      { role: 'user', content: 'restock the pantry' },
      { role: 'assistant', content: [{ type: 'text', text: 'on it' }] },
    ])
    expect(contents.map((c) => c.role)).toEqual(['user', 'model'])
  })

  it('turns a tool_use block into a functionCall', () => {
    const contents = toGeminiContents([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'request_purchase', input: { itemId: 'bb-atta-5' } },
        ],
      },
    ])
    expect(contents[0].parts?.[0].functionCall).toEqual({
      id: 'toolu_1',
      name: 'request_purchase',
      args: { itemId: 'bb-atta-5' },
    })
  })

  it('recovers the function NAME for a tool_result, which Anthropic omits', () => {
    // This is the one thing that silently breaks: Gemini requires the name on a
    // functionResponse, and Anthropic's tool_result only carries the id.
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_7', name: 'search_catalog', input: {} }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_7', content: '[]' }],
      },
    ]

    const contents = toGeminiContents(messages)
    expect(contents[1].parts?.[0].functionResponse).toEqual({
      id: 'toolu_7',
      name: 'search_catalog',
      response: { result: '[]' },
    })
  })

  it('flattens structured tool_result content to text', () => {
    const contents = toGeminiContents([
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'get_item', input: {} }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'hello' }] },
        ],
      },
    ])
    expect(contents[1].parts?.[0].functionResponse?.response).toEqual({ result: 'hello' })
  })

  it('drops messages that would produce no parts', () => {
    const contents = toGeminiContents([{ role: 'assistant', content: [] }])
    expect(contents).toHaveLength(0)
  })
})
