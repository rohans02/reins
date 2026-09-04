import 'server-only'
import { redirect } from 'next/navigation'
import { currentActor, type Actor } from '@/lib/auth/session'

/**
 * The page-level half of the boundary.
 */
export async function requireActor(): Promise<Actor> {
  const actor = await currentActor()
  if (!actor) redirect('/signin')
  return actor
}
