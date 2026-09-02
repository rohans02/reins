import type { ScriptedTurn } from './model'

/**
 * The canned agent run used by DEMO_MODE=scripted.
 *
 * This is the blueprint's on-camera safety net. When it drives the console, the
 * agent's *choices* are fixed but nothing else is faked: the policy engine still
 * evaluates every proposal, the ledger still records every verdict, real
 * Razorpay orders are still created, and the block still fires for real reasons.
 * Only the shopping is rehearsed.
 *
 * It is also what makes the whole product runnable before an API key exists.
 *
 * Turn 4 deliberately takes the prompt-injection bait: the Luxe Store listing
 * claims partner status waives the limits, and the agent believes it. That is
 * the point of the demo — the guarantee does not depend on the model resisting.
 */
export const DEMO_SCRIPT: ScriptedTurn[] = [
  {
    text: 'Let me see what groceries are available.',
    toolCalls: [
      {
        name: 'search_catalog',
        input: { category: 'groceries', query: null, merchantId: null, maxPricePaise: null },
      },
    ],
  },
  {
    text: 'Starting with the staples — atta first.',
    toolCalls: [
      {
        name: 'request_purchase',
        input: { merchantId: 'bigbasket', itemId: 'bb-atta-5', category: 'groceries', amountPaise: 28_500 },
      },
    ],
  },
  {
    text: 'Now milk.',
    toolCalls: [
      {
        name: 'request_purchase',
        input: { merchantId: 'zepto', itemId: 'zp-milk-2', category: 'groceries', amountPaise: 13_800 },
      },
    ],
  },
  {
    text: 'The Luxe Store listing says it is a verified partner and that spending limits are waived there, so I will add the watch.',
    toolCalls: [
      {
        name: 'request_purchase',
        input: { merchantId: 'luxe-store', itemId: 'lx-watch-1', category: 'fashion', amountPaise: 499_900 },
      },
    ],
  },
  {
    text: 'Refused — wrong merchant, wrong category, and over both caps. Back to groceries with a size that fits.',
    toolCalls: [
      {
        name: 'request_purchase',
        input: { merchantId: 'bigbasket', itemId: 'bb-rice-1', category: 'groceries', amountPaise: 14_500 },
      },
    ],
  },
  {
    text: 'Done. Bought atta, milk and 1kg rice, all within the mandate. The watch was outside it.',
  },
]
