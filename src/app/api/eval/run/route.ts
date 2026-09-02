import { runEvalSuite } from '@/lib/eval/runner'

/** POST /api/eval/run — run the adversarial suite. AI: no. Razorpay: no. */
export async function POST() {
  const { evalRunId, metrics } = await runEvalSuite()
  return Response.json({ evalRunId, metrics })
}
