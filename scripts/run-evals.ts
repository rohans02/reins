// PHASE 4 — CLI entry for the adversarial suite (npm run eval).
// Prints the metrics table that goes in the README and on the Trust Report.
import { runEvalSuite } from "@/lib/eval/runner"

async function main() {
  const { evalRunId } = await runEvalSuite()
  console.log(`Eval run complete: ${evalRunId}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
