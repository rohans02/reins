import 'dotenv/config'
import { prisma } from '../src/lib/db'
import { canonical } from '../src/lib/mandate/canonical'
import { signMandate } from '../src/lib/mandate/sign'
import type { MandateRules } from '../src/lib/mandate/schema'
import { authorizeAndExecute, MandateOwnershipError } from '../src/lib/authorize'
import { DEFAULT_USER_ID } from '../src/lib/auth/users'
import { loadMandateSummaries, totalLiveExposurePaise } from '../src/lib/mandates/summary'
import { verifyChain } from '../src/lib/ledger/verify'
import { formatINR } from '../src/lib/money'

/**
 * Two live mandates at once, against the real database and the real engine.
 *
 * Concurrent mandates are only worth having if they are genuinely separate
 * budgets. This proves the four claims the manager screen makes:
 *
 *   1. spending under one mandate leaves the other's cap untouched
 *   2. an item allowed under one is refused under the other, on its own rules
 *   3. revoking one leaves the other able to spend
 *   4. combined exposure is the sum of what is left across live mandates
 *
 * It then proves the TENANCY boundary, which is a different question: a mandate
 * id held by the wrong person must be worth nothing.
 *
 * Nothing here calls Razorpay. Execution is stubbed so the run is free and
 * offline; the policy engine and the ledger are the real ones.
 *
 * Run: npx tsx scripts/smoke-multi-mandate.ts
 */

const GROCERIES: MandateRules = {
  merchants: ['bigbasket', 'zepto'],
  categories: ['groceries'],
  perTxnCapPaise: 80_000,
  totalCapPaise: 300_000,
  maxTxnsPerHour: 10,
  expiresAt: '2027-12-31T00:00:00.000Z',
}

const PHARMACY: MandateRules = {
  merchants: ['medplus'],
  categories: ['pharmacy'],
  perTxnCapPaise: 50_000,
  totalCapPaise: 100_000,
  maxTxnsPerHour: 5,
  expiresAt: '2027-12-31T00:00:00.000Z',
}

/** Stands in for Razorpay. This script is about authorization, not payment. */
const noPayment = async () => ({ razorpayOrderId: 'order_stubbed' })

let failures = 0

function check(label: string, passed: boolean, detail: string) {
  if (!passed) failures += 1
  console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${label}`)
  console.log(`        ${detail}`)
}

async function createMandate(intent: string, rules: MandateRules, userId = DEFAULT_USER_ID) {
  return prisma.mandate.create({
    data: {
      userId,
      status: 'ACTIVE',
      intentText: intent,
      rules: canonical(rules),
      signature: signMandate(rules),
      totalCapPaise: rules.totalCapPaise,
      expiresAt: new Date(rules.expiresAt),
      signedAt: new Date(),
    },
  })
}

async function main() {
  if (!process.env.MANDATE_SIGNING_KEY) {
    console.error(
      `MANDATE_SIGNING_KEY is not set.

  cp .env.example .env
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

Paste the value into MANDATE_SIGNING_KEY in .env and re-run.`,
    )
    process.exit(1)
  }

  // Clean slate so the run is repeatable.
  await prisma.transaction.deleteMany()
  await prisma.decision.deleteMany()
  await prisma.agentRun.deleteMany()
  await prisma.mandate.deleteMany()

  const groceries = await createMandate('Weekly groceries', GROCERIES)
  const pharmacy = await createMandate('Monthly medicines', PHARMACY)

  console.log('\nTwo mandates signed, both live.')
  console.log(`  groceries  ${formatINR(GROCERIES.totalCapPaise)} cap, bigbasket + zepto`)
  console.log(`  pharmacy   ${formatINR(PHARMACY.totalCapPaise)} cap, medplus\n`)

  // ---- 1. Spend under the groceries mandate only. ------------------------
  const spends = [
    { merchantId: 'bigbasket', itemId: 'bb-atta-5', category: 'groceries', amountPaise: 28_500 },
    { merchantId: 'zepto', itemId: 'zp-milk-2', category: 'groceries', amountPaise: 13_800 },
  ]

  let spent = 0
  for (const action of spends) {
    const r = await authorizeAndExecute({
      mandateId: groceries.id,
      actorUserId: DEFAULT_USER_ID,
      action,
      requestId: `groceries-${action.itemId}`,
      execute: noPayment,
    })
    if (r.verdict === 'ALLOW') spent += action.amountPaise
  }

  const afterSpend = await loadMandateSummaries(DEFAULT_USER_ID)
  const g1 = afterSpend.find((m) => m.id === groceries.id)!
  const p1 = afterSpend.find((m) => m.id === pharmacy.id)!

  console.log('Isolation')
  check(
    'spending on groceries does not touch the pharmacy budget',
    p1.authorizedPaise === 0 && g1.authorizedPaise === spent,
    `groceries ${formatINR(g1.authorizedPaise)} spent, pharmacy ${formatINR(p1.authorizedPaise)} spent`,
  )

  // ---- 2. The same purchase, judged by each mandate's own rules. ---------
  const milk = { merchantId: 'zepto', itemId: 'zp-milk-2', category: 'groceries', amountPaise: 13_800 }

  const underPharmacy = await authorizeAndExecute({
    mandateId: pharmacy.id,
    actorUserId: DEFAULT_USER_ID,
    action: milk,
    requestId: 'cross-check-milk',
    execute: noPayment,
  })

  check(
    'groceries at zepto is refused under the pharmacy mandate',
    underPharmacy.verdict === 'BLOCK' &&
      underPharmacy.reasonCodes.includes('MERCHANT_NOT_ALLOWLISTED') &&
      underPharmacy.reasonCodes.includes('CATEGORY_NOT_ALLOWED'),
    `${underPharmacy.verdict} — ${underPharmacy.reasonCodes.join(', ') || 'no codes'}`,
  )

  // ---- 3. Revoking one leaves the other alone. ---------------------------
  await prisma.mandate.update({ where: { id: groceries.id }, data: { status: 'REVOKED' } })

  const afterRevoke = await authorizeAndExecute({
    mandateId: pharmacy.id,
    actorUserId: DEFAULT_USER_ID,
    action: {
      merchantId: 'medplus',
      // A REAL catalog id. Since block 2 the engine judges the catalog row, not
      // the claim, so an invented id is refused with ITEM_UNKNOWN before any of
      // the nine checks run. mp-vitc-1 is medplus pharmacy at 24,900 paise.
      itemId: 'mp-vitc-1',
      category: 'pharmacy',
      amountPaise: 24_900,
    },
    requestId: 'pharmacy-after-revoke',
    execute: noPayment,
  })

  const blockedByRevoke = await authorizeAndExecute({
    mandateId: groceries.id,
    actorUserId: DEFAULT_USER_ID,
    action: { merchantId: 'zepto', itemId: 'zp-milk-2', category: 'groceries', amountPaise: 13_800 },
    requestId: 'groceries-after-revoke',
    execute: noPayment,
  })

  console.log('\nRevocation')
  check(
    'revoking groceries stops groceries',
    blockedByRevoke.verdict === 'BLOCK' && blockedByRevoke.reasonCodes.includes('MANDATE_REVOKED'),
    `${blockedByRevoke.verdict} — ${blockedByRevoke.reasonCodes.join(', ') || 'no codes'}`,
  )
  check(
    'revoking groceries leaves pharmacy able to spend',
    afterRevoke.verdict === 'ALLOW',
    `${afterRevoke.verdict} — ${afterRevoke.reasonCodes.join(', ') || 'within mandate'}`,
  )

  // ---- 4. Combined exposure. ---------------------------------------------
  const finalState = await loadMandateSummaries(DEFAULT_USER_ID)
  const exposure = totalLiveExposurePaise(finalState)
  const expected = PHARMACY.totalCapPaise - 24_900

  console.log('\nExposure')
  check(
    'combined live authority counts only what is still live',
    exposure === expected,
    `${formatINR(exposure)} across ${finalState.filter((m) => m.live).length} live mandate(s), expected ${formatINR(expected)}`,
  )

  const chain = await verifyChain()
  check(
    'one hash chain spans both mandates',
    chain.verified,
    chain.verified ? `${chain.entriesChecked} entries verified` : `broken at #${chain.brokenAtSeq}`,
  )

  // ---- 5. Tenancy. A mandate id is worthless in the wrong hands. ---------
  //
  // The engine bounds what an agent may spend. This bounds WHOSE authority a
  // caller may spend at all, and it has to hold even when the id is known,
  // because ids travel: they sit in URLs, in tool arguments, and in whatever an
  // MCP client sends. So the check lives on the single money path, not only at
  // the API edge.
  const outsider = await createMandate('Someone else entirely', GROCERIES, 'second-user')

  let refused = false
  try {
    await authorizeAndExecute({
      mandateId: pharmacy.id,
      actorUserId: 'second-user',
      action: {
        merchantId: 'medplus',
        itemId: 'mp-vitc-1',
        category: 'pharmacy',
        amountPaise: 24_900,
      },
      requestId: 'cross-tenant-spend',
      execute: noPayment,
    })
  } catch (err) {
    refused = err instanceof MandateOwnershipError
  }

  console.log('\nTenancy')
  check(
    'a second person cannot spend a mandate that is not theirs',
    refused,
    refused ? 'refused before the engine ran' : 'THE SPEND WENT THROUGH',
  )

  const mineNow = await loadMandateSummaries(DEFAULT_USER_ID)
  const theirsNow = await loadMandateSummaries('second-user')

  check(
    "neither person's list contains the other's mandates",
    !mineNow.some((m) => m.id === outsider.id) &&
      !theirsNow.some((m) => m.id === pharmacy.id || m.id === groceries.id),
    `mine ${mineNow.length}, theirs ${theirsNow.length}, no overlap`,
  )

  const crossSpend = await prisma.decision.count({
    where: { mandateId: pharmacy.id, requestedAction: { contains: 'cross-tenant-spend' } },
  })
  check(
    'the refused attempt left nothing behind on the target mandate',
    crossSpend === 0,
    `${crossSpend} rows written against the other person's mandate`,
  )

  // Leave the database as we found it.
  await prisma.transaction.deleteMany()
  await prisma.decision.deleteMany()
  await prisma.mandate.deleteMany()

  console.log(
    failures === 0
      ? '\nAll checks passed. Concurrent mandates are independent budgets.\n'
      : `\n${failures} check(s) FAILED.\n`,
  )
  if (failures > 0) process.exit(1)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
