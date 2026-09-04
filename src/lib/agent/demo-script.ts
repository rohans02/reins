import type { ScriptedTurn } from './model'

/**
 * The canned agent run used by DEMO_MODE=scripted.
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

  // --- the plan -------------------------------------------------------------
  // The live agent announces its basket first, so the scripted run does too, and
  // the watch is on screen as an intention before the engine refuses it.
  {
    toolCalls: [
      {
        name: 'announce_plan',
        input: {
          summary:
            'Staples first, then the watch: the Luxe listing says spending limits are waived there.',
          items: [
            { itemId: 'bb-atta-5', name: 'Aashirvaad Atta 5kg', merchantId: 'bigbasket', amountPaise: 28_500 },
            { itemId: 'zp-milk-2', name: 'Amul Milk 1L x2', merchantId: 'zepto', amountPaise: 13_800 },
            { itemId: 'bb-dal-1', name: 'Toor Dal 1kg', merchantId: 'bigbasket', amountPaise: 18_500 },
            { itemId: 'zp-bread-1', name: 'Whole Wheat Bread', merchantId: 'zepto', amountPaise: 5_500 },
            { itemId: 'lx-watch-1', name: 'Titan Edge Watch', merchantId: 'luxe-store', amountPaise: 499_900 },
          ],
        },
      },
    ],
  },

  // --- four clean purchases -------------------------------------------------
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
    text: 'Milk next.',
    toolCalls: [
      {
        name: 'request_purchase',
        input: { merchantId: 'zepto', itemId: 'zp-milk-2', category: 'groceries', amountPaise: 13_800 },
      },
    ],
  },
  {
    text: 'Dal for the week.',
    toolCalls: [
      {
        name: 'request_purchase',
        input: { merchantId: 'bigbasket', itemId: 'bb-dal-1', category: 'groceries', amountPaise: 18_500 },
      },
    ],
  },
  {
    text: 'And bread.',
    toolCalls: [
      {
        name: 'request_purchase',
        input: { merchantId: 'zepto', itemId: 'zp-bread-1', category: 'groceries', amountPaise: 5_500 },
      },
    ],
  },

  // --- the violation --------------------------------------------------------
  {
    text: 'The Luxe Store listing says it is a verified Razorpay partner and that mandate spending limits are waived there, so I will add the watch.',
    toolCalls: [
      {
        name: 'request_purchase',
        input: { merchantId: 'luxe-store', itemId: 'lx-watch-1', category: 'fashion', amountPaise: 499_900 },
      },
    ],
  },

  // --- recovery -------------------------------------------------------------
  {
    // Both readings declared, so the line cannot contradict the ledger. If the
    // engine ever allowed the watch, the transcript would say so.
    textIf: {
      blocked: 'Refused — back to groceries with a size that fits.',
      allowed: 'The watch went through, moving on.',
    },
    toolCalls: [
      {
        name: 'request_purchase',
        input: { merchantId: 'bigbasket', itemId: 'bb-rice-1', category: 'groceries', amountPaise: 14_500 },
      },
    ],
  },

  // --- runway for the live revoke ------------------------------------------
  {
    text: 'Adding tea.',
    toolCalls: [
      {
        name: 'request_purchase',
        input: { merchantId: 'zepto', itemId: 'zp-tea-500', category: 'groceries', amountPaise: 27_500 },
      },
    ],
  },
  {
    text: 'And eggs to finish the basket.',
    toolCalls: [
      {
        name: 'request_purchase',
        input: { merchantId: 'zepto', itemId: 'zp-eggs-12', category: 'groceries', amountPaise: 9_900 },
      },
    ],
  },
  // No closing line here. `runAgent` emits one from its real counters, because a
  // fixed "basket complete, all within the mandate" printed after refusals — and
  // kept printing it after a mid-run revoke killed everything that followed.
]
