/**
 * Adversarial suite runner. Loads evals/cases.json, drives each case through the
 * REAL policy engine (never a mock), and writes an EvalRun.
 *
 * Reports, per the Track 1 bar:
 *   - block rate by reason-code category (not just an aggregate)
 *   - unauthorized paise  (must be 0)
 *   - p50 / p99 authorization latency
 *   - ledger chain verified
 *   - autonomous purchases completed
 *
 * The suite MUST include legitimately-ALLOWED cases too. An all-blocks suite
 * proves only that you can say no, and invites "your engine just denies everything".
 *
 * PHASE 4
 */
export async function runEvalSuite(): Promise<{ evalRunId: string }> {
  throw new Error('runEvalSuite(): not implemented — Phase 4')
}
