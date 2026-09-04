import { currentUserId } from '@/lib/auth/session'
import { runEvalSuite } from '@/lib/eval/runner'

/**
 * POST /api/eval/run — run the adversarial suite. AI: no. Razorpay: no.
 *
 * Guarded because it is compute on demand and it writes an EvalRun row. The
 * numbers it produces are public and reproducible by anyone who clones the repo
 * and runs `npm run eval`; what is not public is the right to make this server
 * do the work.
 */
export async function POST() {
  if (!(await currentUserId())) {
    return Response.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { evalRunId, metrics } = await runEvalSuite()
  return Response.json({ evalRunId, metrics })
}
