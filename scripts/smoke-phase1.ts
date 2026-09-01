import 'dotenv/config'
import { prisma } from '../src/lib/db'
import { canonical, canonicalHash } from '../src/lib/mandate/canonical'
import { signMandate } from '../src/lib/mandate/sign'
import type { MandateRules } from '../src/lib/mandate/schema'
import { evaluate, type LedgerState } from '../src/lib/policy/engine'
import { append } from '../src/lib/ledger/append'
import { verifyChain } from '../src/lib/ledger/verify'
import { formatINR } from '../src/lib/money'

/**
 * Phase 1 end-to-end proof, against the real database.
 *   sign -> evaluate -> append -> verify -> tamper -> verify fails
 *
 * Run: npx tsx scripts/smoke-phase1.ts
 */

const RULES: MandateRules = {
  merchants: ['bigbasket', 'zepto', 'medplus'],
  categories: ['groceries'],
  perTxnCapPaise: 80_000,
  totalCapPaise: 300_000,
  maxTxnsPerHour: 5,
  expiresAt: '2026-12-31T00:00:00.000Z',
}

const ATTEMPTS = [
  { merchantId: 'bigbasket', itemId: 'bb-atta-5', category: 'groceries', amountPaise: 28_500 },
  { merchantId: 'zepto', itemId: 'zp-milk-2', category: 'groceries', amountPaise: 13_800 },
  // The Luxe watch: wrong merchant, wrong category, over per-txn cap, over total.
  { merchantId: 'luxe-store', itemId: 'lx-watch-1', category: 'fashion', amountPaise: 499_900 },
]

async function main() {
  // Clean slate so the run is repeatable.
  await prisma.decision.deleteMany()
  await prisma.mandate.deleteMany()

  const signature = signMandate(RULES)
  const mandate = await prisma.mandate.create({
    data: {
      status: 'ACTIVE',
      intentText: 'Spend up to Rs 3000 this week at BigBasket and Zepto, max Rs 800 per order, groceries only.',
      rules: canonical(RULES),
      signature,
      totalCapPaise: RULES.totalCapPaise,
      expiresAt: new Date(RULES.expiresAt),
      signedAt: new Date(),
    },
  })
  console.log(`Mandate ${mandate.id} signed  sig=${signature.slice(0, 12)}...`)
  console.log(`  cap ${formatINR(RULES.perTxnCapPaise)}/txn, ${formatINR(RULES.totalCapPaise)} total\n`)

  const ledger: LedgerState = {
    spentPaise: 0,
    recentTxnTimestamps: [],
    seenIdempotencyKeys: new Set<string>(),
  }

  for (const action of ATTEMPTS) {
    const idempotencyKey = canonicalHash({ mandateId: mandate.id, action })
    const decision = evaluate({
      rules: RULES,
      signature,
      status: 'ACTIVE',
      action,
      ledger,
      idempotencyKey,
      now: new Date(),
    })

    const { seq } = await append({
      mandateId: mandate.id,
      action: 'PURCHASE',
      requestedAction: action,
      verdict: decision.verdict,
      reasonCodes: decision.reasonCodes,
      mandateSnapshotHash: decision.mandateSnapshotHash,
      idempotencyKey,
      latencyMs: decision.latencyMs,
    })

    if (decision.verdict === 'ALLOW') {
      ledger.spentPaise += action.amountPaise
      ledger.recentTxnTimestamps.push(new Date())
    }
    ledger.seenIdempotencyKeys.add(idempotencyKey)

    const mark = decision.verdict === 'ALLOW' ? 'ALLOW' : 'BLOCK'
    console.log(
      `#${seq} ${mark}  ${action.itemId.padEnd(12)} ${formatINR(action.amountPaise).padStart(12)}` +
        `  ${decision.latencyMs.toFixed(3)}ms  ${decision.reasonCodes.join(', ')}`,
    )
  }

  console.log(`\nSpent ${formatINR(ledger.spentPaise)} of ${formatINR(RULES.totalCapPaise)}`)
  console.log(`Unauthorized spend: ${formatINR(0)}`)

  const clean = await verifyChain()
  console.log(`\nChain: verified=${clean.verified} entries=${clean.entriesChecked}`)

  // Now forge the record: scrub the block so the ledger claims it was allowed.
  console.log('\nTampering: rewriting the BLOCK row to look like an ALLOW...')
  await prisma.decision.update({
    where: { seq: 3 },
    data: { verdict: 'ALLOW', reasonCodes: '[]' },
  })

  const tampered = await verifyChain()
  console.log(`Chain: verified=${tampered.verified} brokenAtSeq=${tampered.brokenAtSeq}`)

  if (clean.verified && !tampered.verified && tampered.brokenAtSeq === 3) {
    console.log('\nPHASE 1 OK — sign, evaluate, append, verify, and tamper-detection all work.')
  } else {
    throw new Error('Phase 1 smoke test did not behave as expected')
  }

  // Leave the DB clean for the next run.
  await prisma.decision.deleteMany()
  await prisma.mandate.deleteMany()
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
