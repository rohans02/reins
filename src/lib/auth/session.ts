import 'server-only'
import { cookies } from 'next/headers'
import { auth } from '@/lib/auth/authjs'
import { authEnabled } from '@/lib/auth/providers'
import { COOKIE_NAME, DEFAULT_USER_ID, isKnownUser, userName } from '@/lib/auth/users'

/**
 * ============================================================================
 *  WHO IS ASKING — the single place the application answers that question.
 * ============================================================================
 *
 * Every owner-scoped query and every ownership check goes through here, which
 * is what made real authentication a small change rather than a rewrite: the
 * enforcement was already in place and already keyed on this function's answer.
 *
 * TWO MODES, and the difference between them is narrow and worth being precise
 * about.
 *
 *   OAuth configured   the id comes from a signed session cookie that a person
 *                      obtained by proving control of a GitHub or Google
 *                      account. Unauthenticated requests get NOTHING.
 *   nothing configured  the id comes from a plain cookie anyone can set. This
 *                      is an asserted identity, not a proven one.
 *
 * What does NOT differ is enforcement. Both modes return an id, and every read
 * is filtered by it and every write is checked against it either way. The
 * second mode exists so that a judge cloning this repo, with no OAuth app of
 * their own, can still open the product — the same reason the agent falls back
 * to a scripted model with no API key.
 *
 * The fallback is announced in the UI rather than hidden, because an identity
 * that was asserted must never look like one that was proven.
 */

export { DEFAULT_USER_ID, COOKIE_NAME, DEMO_USERS, isKnownUser, userName } from '@/lib/auth/users'
export { authEnabled, configuredProviders } from '@/lib/auth/providers'

export interface Actor {
  id: string
  name: string
  /** True when the identity was proven by OAuth rather than merely asserted. */
  authenticated: boolean
}

/**
 * The current actor, or null when sign-in is required and has not happened.
 *
 * Returning null rather than falling back is the whole point once auth is on. A
 * fallback here would mean an unauthenticated request quietly became somebody,
 * and every ownership check downstream would then pass for that somebody.
 */
export async function currentActor(): Promise<Actor | null> {
  if (authEnabled()) {
    const session = await auth()
    const id = session?.user?.mandateUserId
    if (!id) return null
    return {
      id,
      name: session.user.displayName ?? session.user.name ?? 'Signed in',
      authenticated: true,
    }
  }

  const raw = (await cookies()).get(COOKIE_NAME)?.value
  // An unknown id falls back rather than being trusted, so a made-up cookie
  // value cannot conjure an empty tenant on demand.
  const id = raw && isKnownUser(raw) ? raw : DEFAULT_USER_ID
  return { id, name: userName(id), authenticated: false }
}

/** Convenience for the many callers that only need the id. */
export async function currentUserId(): Promise<string | null> {
  return (await currentActor())?.id ?? null
}
