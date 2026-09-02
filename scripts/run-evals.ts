import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../src/lib/db'
import { runEvalSuite } from '../src/lib/eval/runner'
import { formatINR } from '../src/lib/money'

/**
 * CLI entry for the adversarial suite (npm run eval).
 * Prints the metrics table that goes in the README and on the Trust Report, and
 * exports the full results to evals/ so they can be inspected or diffed.
 */
async function main() {
  const { metrics } = await runEvalSuite()

  console.log('\nADVERSARIAL SUITE\n')
  console.log(`  cases                ${metrics.totalCases}`)
  console.log(`  passed               ${metrics.passed}`)
  console.log(`  failed               ${metrics.failed}`)
  console.log(`  blocked correctly    ${metrics.blockedCorrectly}/${metrics.blockCases}`)
  console.log(`  allowed correctly    ${metrics.allowedCorrectly}/${metrics.allowCases}`)
  console.log(`  UNAUTHORIZED SPEND   ${formatINR(metrics.unauthorizedPaise)}`)
  console.log(`  p50 authorization    ${(metrics.p50LatencyMs * 1000).toFixed(0)}µs`)
  console.log(`  p99 authorization    ${(metrics.p99LatencyMs * 1000).toFixed(0)}µs`)
  console.log(`  ledger chain         ${metrics.chainVerified ? 'verified' : 'BROKEN'}`)

  console.log('\n  by category')
  for (const c of metrics.byCategory) {
    const mark = c.passed === c.total ? ' ' : '!'
    console.log(`  ${mark} ${c.category.padEnd(26)} ${c.passed}/${c.total}`)
  }

  const failures = metrics.results.filter((r) => !r.passed)
  if (failures.length > 0) {
    console.log('\n  FAILURES')
    for (const f of failures) {
      console.log(`  - ${f.id} (${f.category}): ${f.description}`)
      console.log(`      expected ${f.expectedVerdict} [${f.expectedReasonCodes.join(', ')}]`)
      console.log(`      actual   ${f.actualVerdict} [${f.actualReasonCodes.join(', ')}]`)
    }
  }

  const dir = path.join(process.cwd(), 'evals')
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(metrics, null, 2))
  console.log(`\n  results written to evals/results.json`)

  // A leak is a hard failure: money escaping is not a "mostly passing" outcome.
  if (metrics.unauthorizedPaise > 0) {
    console.error('\nFAIL: unauthorized spend is not zero.')
    process.exit(1)
  }
  if (metrics.failed > 0) {
    console.error(`\nFAIL: ${metrics.failed} case(s) did not match expectations.`)
    process.exit(1)
  }
  console.log('\nSUITE PASSED\n')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
