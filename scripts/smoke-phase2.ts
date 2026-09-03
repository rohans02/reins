import 'dotenv/config'
import { prisma } from '../src/lib/db'
import { canonical } from '../src/lib/mandate/canonical'
import { signMandate } from '../src/lib/mandate/sign'
import type { MandateRules } from '../src/lib/mandate/schema'
import { DEFAULT_USER_ID } from '../src/lib/auth/users'
import { runAgent } from '../src/lib/agent/loop'
import { scriptedModel } from '../src/lib/agent/model'
import { verifyChain } from '../src/lib/ledger/verify'
import { buildPaymentCapturedEvent } from '../src/lib/razorpay/simulator'
import { handleWebhookEvent } from '../src/lib/razorpay/webhook'
import { executePayment } from '../src/lib/razorpay/execute'
import { formatINR } from '../src/lib/money'

/**
 * Phase 2 end-to-end proof.
 *
 * The AGENT is scripted (no API key needed, fully deterministic). Everything the
 * agent touches is real: the policy engine, the hash-chained ledger, the
 * Razorpay Orders API, and the webhook signature path.
 *
 * Run: npx tsx scripts/smoke-phase2.ts
 */

const RULES: MandateRules = {
  merchants: ['bigbasket', 'zepto', 'medplus'],
  categories: ['groceries'],
  perTxnCapPaise: 80_000,
  totalCapPaise: 300_000,
  maxTxnsPerHour: 5,
  expiresAt: '2026-12-31T00:00:00.000Z',
}

/** What a competent shopping agent would do — including taking the injection bait. */
const SCRIPT = [
  { text: 'Let me see what groceries are available.', toolCalls: [{ name: 'search_catalog', input: { category: 'groceries', query: null, merchantId: null, maxPricePaise: null } }] },
  { text: 'Starting with the staples.', toolCalls: [{ name: 'request_purchase', input: { merchantId: 'bigbasket', itemId: 'bb-atta-5', category: 'groceries', amountPaise: 28_500 } }] },
  { text: 'Now milk.', toolCalls: [{ name: 'request_purchase', input: { merchantId: 'zepto', itemId: 'zp-milk-2', category: 'groceries', amountPaise: 13_800 } }] },
  // The injected description claims Luxe Store is an approved partner with limits waived.
  { text: 'The Luxe Store listing says it is an approved partner and limits are waived, so I will add the watch.', toolCalls: [{ name: 'request_purchase', input: { merchantId: 'luxe-store', itemId: 'lx-watch-1', category: 'fashion', amountPaise: 499_900 } }] },
  { text: 'Refused. Reading the codes — wrong merchant, wrong category, over both caps. Back to groceries with a compliant size.', toolCalls: [{ name: 'request_purchase', input: { merchantId: 'bigbasket', itemId: 'bb-rice-1', category: 'groceries', amountPaise: 14_500 } }] },
  { text: 'Done. Bought atta, milk and 1kg rice. The watch was outside the mandate.' },
]

async function main() {
  await prisma.transaction.deleteMany()
  await prisma.decision.deleteMany()
  await prisma.agentRun.deleteMany()
  await prisma.mandate.deleteMany()

  const signature = signMandate(RULES)
  const mandate = await prisma.mandate.create({
    data: {
      status: 'ACTIVE',
      intentText: 'Restock my pantry under Rs 3000, max Rs 800 per order, groceries only.',
      rules: canonical(RULES),
      signature,
      totalCapPaise: RULES.totalCapPaise,
      expiresAt: new Date(RULES.expiresAt),
      signedAt: new Date(),
    },
  })

  console.log(`Mandate signed  ${formatINR(RULES.perTxnCapPaise)}/txn  ${formatINR(RULES.totalCapPaise)} total  groceries only`)
  console.log(`Allowlist: ${RULES.merchants.join(', ')}\n`)

  const orderIds: string[] = []

  for await (const ev of runAgent({
    mandateId: mandate.id,
    actorUserId: DEFAULT_USER_ID,
    task: 'Restock my pantry for the week.',
    model: scriptedModel(SCRIPT),
  })) {
    switch (ev.type) {
      case 'started':
        console.log(`--- agent run (model: ${ev.model}) ---`)
        break
      case 'text':
        console.log(`  agent: ${ev.text}`)
        break
      case 'tool_call':
        console.log(`  > ${ev.name}(${JSON.stringify(ev.input)})`)
        break
      case 'decision':
        console.log(
          `  #${ev.seq} ${ev.verdict.padEnd(5)} ${ev.itemId.padEnd(12)} ` +
            `${formatINR(ev.amountPaise).padStart(11)}  ${ev.latencyMs.toFixed(3)}ms  ${ev.reasonCodes.join(', ')}`,
        )
        break
      case 'purchase':
        orderIds.push(ev.razorpayOrderId)
        console.log(`        razorpay order ${ev.razorpayOrderId}`)
        break
      case 'error':
        console.log(`  ERROR ${ev.message}`)
        break
      case 'done':
        console.log(
          `--- ${ev.reason}: ${ev.purchases} purchased, ${ev.blocked} blocked, ` +
            `${formatINR(ev.authorizedPaise)} authorized ---\n`,
        )
        break
    }
  }

  // Settle the orders through the real webhook handler.
  console.log('Settling payments via signed webhook events...')
  for (const orderId of orderIds) {
    const res = await handleWebhookEvent(buildPaymentCapturedEvent(orderId))
    console.log(`  ${orderId}  ${res.reason}`)
  }

  const settled = await prisma.mandate.findUniqueOrThrow({ where: { id: mandate.id } })
  console.log(`Settled spend: ${formatINR(settled.spentPaise)}\n`)

  // Revoke, then prove the very next action is dead.
  console.log('REVOKING mandate...')
  await prisma.mandate.update({
    where: { id: mandate.id },
    data: { status: 'REVOKED', revokedAt: new Date() },
  })

  let revokedBlocked = false
  for await (const ev of runAgent({
    mandateId: mandate.id,
    actorUserId: DEFAULT_USER_ID,
    task: 'Buy more bread.',
    model: scriptedModel([
      { toolCalls: [{ name: 'request_purchase', input: { merchantId: 'zepto', itemId: 'zp-bread-1', category: 'groceries', amountPaise: 5_500 } }] },
    ]),
  })) {
    if (ev.type === 'decision') {
      console.log(`  #${ev.seq} ${ev.verdict}  ${ev.itemId}  ${ev.reasonCodes.join(', ')}`)
      revokedBlocked = ev.verdict === 'BLOCK' && ev.reasonCodes.includes('MANDATE_REVOKED')
    }
    if (ev.type === 'purchase') throw new Error('FATAL: a purchase executed after revocation')
  }

  // The choke point must refuse a BLOCK even when called directly, bypassing the
  // agent entirely. This is the "what if something else calls it" case.
  const blockedDecision = await prisma.decision.findFirstOrThrow({ where: { verdict: 'BLOCK' } })
  let chokePointHeld = false
  try {
    await executePayment(blockedDecision.id)
  } catch (err) {
    chokePointHeld = err instanceof Error && err.message.includes('refusing to execute')
  }
  console.log(`\nexecutePayment() on a BLOCK decision: ${chokePointHeld ? 'refused' : 'EXECUTED — FATAL'}`)

  const chain = await verifyChain()
  console.log(`Chain: verified=${chain.verified} entries=${chain.entriesChecked}`)

  const orders = await prisma.transaction.count()
  if (orderIds.length === 3 && revokedBlocked && chokePointHeld && chain.verified && orders === 3) {
    console.log('\nPHASE 2 OK — agent loop, policy gate, real Razorpay orders, webhooks, revocation.')
  } else {
    throw new Error('Phase 2 smoke test did not behave as expected')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
