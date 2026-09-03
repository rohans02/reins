import 'server-only'
import { cookies } from 'next/headers'
import { COOKIE_NAME, DEFAULT_USER_ID, isKnownUser } from '@/lib/auth/users'

/**
 * ============================================================================
 *  WHO IS ASKING — the one seam between this prototype and real authentication.
 * ============================================================================
 *
 * There is no login here, and that is a deliberate, stated limitation. What is
 * NOT missing is the tenancy boundary, and the difference matters.
 *
 * A login form only answers "who are you". The part that actually protects a
 * mandate is that every read is filtered by owner and every write checks
 * ownership before it does anything, server-side, with no route that can be
 * asked nicely for someone else's data. That work is done. It is enforced in
 * `authorizeAndExecute`, in `runAgent`, in `loadMandateSummaries`, and in every
 * route under /api/mandates.
 *
 * So the whole of the missing auth layer is this function. Replace it with a
 * session lookup and nothing else in the codebase changes, because nothing else
 * asks the question.
 *
 * The cookie is a DEMO INSTRUMENT, in the same spirit as FORCE_ATTEMPT: it
 * exists so the isolation can be demonstrated rather than asserted. Switch
 * user, and the other person's mandates are gone from every screen and their
 * ids stop resolving. It is obviously not a security boundary on its own, since
 * anyone can set a cookie. Neither is a username without a password, which is
 * exactly why the real fix is a session and not more code out here.
 *
 * `server-only` is imported so that a client component importing this fails at
 * BUILD time rather than at request time. It already happened once: the sidebar
 * pulled this module in for the user list and every route started answering 500.
 */

export { DEFAULT_USER_ID, COOKIE_NAME, DEMO_USERS, isKnownUser, userName } from '@/lib/auth/users'

/**
 * The current actor. Every scoped query and every ownership check goes through
 * this, so there is exactly one place that decides who is asking.
 */
export async function currentUserId(): Promise<string> {
  const raw = (await cookies()).get(COOKIE_NAME)?.value
  // An unknown id falls back rather than being trusted. Otherwise a made-up
  // cookie value would create an empty tenant on demand.
  return raw && isKnownUser(raw) ? raw : DEFAULT_USER_ID
}
