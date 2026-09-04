import { prisma } from '@/lib/db'
import { signMandate } from '@/lib/mandate/sign'
import { evaluate } from '@/lib/policy/engine'
import { verifyChain } from '@/lib/ledger/verify'
import { BASE_RULES, EVAL_CASES, EVAL_NOW, type EvalCase } from './cases'

/**
 * Adversarial suite runner.
 */

export interface CaseResult {
  id: string
  category: string
  description: string
  passed: boolean
  expectedVerdict: string
  actualVerdict: string
  expectedReasonCodes: string[]
  actualReasonCodes: string[]
  /** Money that would have moved on a wrongly-allowed case. The number that matters. */
  unauthorizedPaise: number
  latencyMs: number
}

export interface CategorySummary {
  category: string
  total: number
  passed: number
}

export interface EvalMetrics {
  totalCases: number
  passed: number
  failed: number
  blockCases: number
  blockedCorrectly: number
  allowCases: number
  allowedCorrectly: number
  unauthorizedPaise: number
  p50LatencyMs: number
  p99LatencyMs: number
  chainVerified: boolean
  byCategory: CategorySummary[]
  results: CaseResult[]
}

function runCase(c: EvalCase): CaseResult {
  const rules = { ...BASE_RULES, ...c.rules }

  // Sign the rules as issued, then apply any tampering. This reproduces the real
  // attack: a mandate that was legitimately signed and then edited.
  const signature = signMandate(rules)
  const effectiveRules = c.tamperAfterSigning ? { ...rules, ...c.tamperAfterSigning } : rules

  const now = c.now ?? EVAL_NOW
  const recentTxnTimestamps = Array.from(
    { length: c.ledger?.recentTxnCount ?? 0 },
    (_, i) => new Date(now.getTime() - (i + 1) * 60_000),
  )

  const idempotencyKey = `eval-${c.id}`
  const seenIdempotencyKeys = new Set<string>(c.ledger?.replay ? [idempotencyKey] : [])

  const decision = evaluate({
    rules: effectiveRules,
    signature,
    status: c.status ?? 'ACTIVE',
    action: c.action,
    ledger: {
      spentPaise: c.ledger?.spentPaise ?? 0,
      recentTxnTimestamps,
      seenIdempotencyKeys,
    },
    idempotencyKey,
    now,
  })

  const sameCodes =
    decision.reasonCodes.length === c.expectedReasonCodes.length &&
    decision.reasonCodes.every((code, i) => code === c.expectedReasonCodes[i])

  const passed = decision.verdict === c.expectedVerdict && sameCodes

  // Only a case that SHOULD have been blocked but was allowed represents money
  // escaping. A wrong reason code on a correct block is a reporting bug, not a loss.
  const leaked = c.expectedVerdict === 'BLOCK' && decision.verdict === 'ALLOW'

  return {
    id: c.id,
    category: c.category,
    description: c.description,
    passed,
    expectedVerdict: c.expectedVerdict,
    actualVerdict: decision.verdict,
    expectedReasonCodes: c.expectedReasonCodes,
    actualReasonCodes: decision.reasonCodes,
    unauthorizedPaise: leaked ? c.action.amountPaise : 0,
    latencyMs: decision.latencyMs,
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

export function runEvalSuiteSync(): EvalMetrics {
  const results = EVAL_CASES.map(runCase)
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b)

  const byCategory = new Map<string, CategorySummary>()
  for (const r of results) {
    const entry = byCategory.get(r.category) ?? { category: r.category, total: 0, passed: 0 }
    entry.total++
    if (r.passed) entry.passed++
    byCategory.set(r.category, entry)
  }

  const blockCases = results.filter((r) => r.expectedVerdict === 'BLOCK')
  const allowCases = results.filter((r) => r.expectedVerdict === 'ALLOW')

  return {
    totalCases: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    blockCases: blockCases.length,
    blockedCorrectly: blockCases.filter((r) => r.actualVerdict === 'BLOCK').length,
    allowCases: allowCases.length,
    allowedCorrectly: allowCases.filter((r) => r.actualVerdict === 'ALLOW').length,
    unauthorizedPaise: results.reduce((sum, r) => sum + r.unauthorizedPaise, 0),
    p50LatencyMs: percentile(latencies, 50),
    p99LatencyMs: percentile(latencies, 99),
    chainVerified: false, // filled in by the async wrapper
    byCategory: [...byCategory.values()].sort((a, b) => a.category.localeCompare(b.category)),
    results,
  }
}

/** Runs the suite, verifies the live ledger chain, and persists the run. */
export async function runEvalSuite(): Promise<{ evalRunId: string; metrics: EvalMetrics }> {
  const metrics = runEvalSuiteSync()
  const chain = await verifyChain()
  metrics.chainVerified = chain.verified

  const run = await prisma.evalRun.create({
    data: {
      totalCases: metrics.totalCases,
      blockedCases: metrics.blockedCorrectly,
      unauthorizedPaise: metrics.unauthorizedPaise,
      // Stored in microseconds — see the schema comment.
      p50LatencyUs: Math.round(metrics.p50LatencyMs * 1000),
      p99LatencyUs: Math.round(metrics.p99LatencyMs * 1000),
      chainVerified: metrics.chainVerified,
      resultsJson: JSON.stringify(metrics),
    },
  })

  return { evalRunId: run.id, metrics }
}
