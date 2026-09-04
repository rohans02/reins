import { currentUserId } from '@/lib/auth/session'
import { runEvalSuite } from '@/lib/eval/runner'

/**
 * POST /api/eval/run — run the adversarial suite. AI: no. Razorpay: no.
 */
export async function POST() {
  if (!(await currentUserId())) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { evalRunId, metrics } = await runEvalSuite()
  return Response.json({ evalRunId, metrics })
}
