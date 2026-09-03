import 'server-only'
import { redirect } from 'next/navigation'
import { currentActor, type Actor } from '@/lib/auth/session'

/**
 * The page-level half of the boundary.
 *
 * API routes answer 401 to an unauthenticated caller. A page has a person in
 * front of it, so it sends them somewhere useful instead. Both refuse; only the
 * shape of the refusal differs.
 *
 * Every owner-scoped screen calls this FIRST, before any query runs, so there is
 * no path where a page loads data and then decides whether it should have.
 */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor()
  if (!actor) redirect('/signin')
  return actor
}
