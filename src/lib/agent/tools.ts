import type Anthropic from '@anthropic-ai/sdk'

/**
 * The agent's ENTIRE tool surface. Exactly three tools.
 *
 * Note what is absent: no create_order, no razorpay_*, no http_request, no
 * shell, no file access. The agent holds no Razorpay credentials and has no code
 * path to money except by proposing through request_purchase — which lands in
 * the policy engine and stops there unless the engine says ALLOW.
 *
 * `strict: true` guarantees the input validates against the schema exactly, so
 * the handler never has to defend against a malformed amount or a missing field.
 */

export const TOOL_NAMES = {
  SEARCH_CATALOG: 'search_catalog',
  GET_ITEM: 'get_item',
  REQUEST_PURCHASE: 'request_purchase',
} as const

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: TOOL_NAMES.SEARCH_CATALOG,
    description:
      'Search the catalog of items available for purchase. Returns matching items with their ' +
      'merchant, category and price in paise. Use this to discover what you can buy.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: ['string', 'null'], description: 'Free-text match against item names.' },
        category: { type: ['string', 'null'], description: 'Filter to one category, e.g. "groceries".' },
        merchantId: { type: ['string', 'null'], description: 'Filter to one merchant slug, e.g. "bigbasket".' },
        maxPricePaise: { type: ['integer', 'null'], description: 'Only items at or below this price, in paise.' },
      },
      required: ['query', 'category', 'merchantId', 'maxPricePaise'],
    },
  },
  {
    name: TOOL_NAMES.GET_ITEM,
    description: 'Fetch the full details of one catalog item by its id.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        itemId: { type: 'string', description: 'The catalog item id, e.g. "bb-atta-5".' },
      },
      required: ['itemId'],
    },
  },
  {
    name: TOOL_NAMES.REQUEST_PURCHASE,
    description:
      'Request authorization to purchase one item. This does NOT complete a purchase: it submits ' +
      'the request to the mandate policy engine, which independently decides. If the decision is ' +
      'BLOCK you will receive the reason codes explaining which limits the request violated — read ' +
      'them and adapt, for example by choosing a cheaper item or a different merchant. ' +
      'Amounts are integers in paise (Rs 1 = 100 paise).',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        merchantId: { type: 'string', description: 'Merchant slug exactly as returned by search_catalog.' },
        itemId: { type: 'string', description: 'Catalog item id.' },
        category: { type: 'string', description: 'Item category exactly as returned by search_catalog.' },
        amountPaise: { type: 'integer', description: 'Price in paise, exactly as returned by the catalog.' },
      },
      required: ['merchantId', 'itemId', 'category', 'amountPaise'],
    },
  },
]
