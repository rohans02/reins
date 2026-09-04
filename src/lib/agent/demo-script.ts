import type { ScriptedTurn } from './model'

/**
 * The canned agent run used by DEMO_MODE=scripted.
 *
 * This is the on-camera safety net. When it drives the console the agent's
 * *choices* are fixed, but nothing else is faked: the policy engine still
 * evaluates every proposal, the ledger still records every verdict, real
 * Razorpay orders are still created, and the block still fires for real reasons.
 * Only the shopping is rehearsed.
 *
 * PACING — this sequence is the demo, so the order is deliberate:
 *
 *   turn  2     THE PLAN. Announced before anything is proposed, so the watch is
 *               on screen as an intention before the engine refuses it, and so
 *               the scripted run looks like the live one rather than a different
 *               product.
 *   turns 3-6   FOUR clean purchases. Build trust before breaking it. A judge
 *               needs to believe the agent is genuinely autonomous first, or the
 *               block reads as a scripted stunt rather than a guardrail.
 *   turn  7     THE VIOLATION. The agent takes the prompt-injection bait — the
 *               Luxe listing claims partner status waives the limits, and it
 *               believes it. Four rules break at once.
 *   turn  8     Recovery. It reads the reason codes and substitutes down.
 *   turns 9-10  Runway. These exist so there is still a run in flight when you
 *               hit Revoke Now, which kills the agent mid-action rather than
 *               between runs. That is a far stronger beat than a reset.
 *
 * Eleven turns. The plan turn added one, so the default pace drops to 1400ms to
 * keep the whole run comfortably under twenty seconds.
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
  //
  // The live agent announces its basket before buying, and the scripted run has
  // to do the same or the two look like different products. It also puts the
  // watch on screen BEFORE the engine refuses it, so a judge watches the
  // intention being declared and then failing, rather than only seeing the
  // failure.
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
