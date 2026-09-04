import 'server-only'
import { cookies } from 'next/headers'
import { auth } from '@/lib/auth/authjs'
import { authEnabled } from '@/lib/auth/providers'
import { COOKIE_NAME, DEFAULT_USER_ID, isKnownUser, userName } from '@/lib/auth/users'

/**
 * Who is asking: the one place the app answers that, and the whole auth seam.
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
