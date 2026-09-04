import { requireActor } from '@/lib/auth/guard'
import { MandateStudio } from '@/components/MandateStudio'

/**
 * Mandate Studio — a thin Server Component around the studio form.
 */

// The default expiry is relative to now, so this page must never be prerendered
// at build time — a baked-in timestamp would arrive already expired.
export const dynamic = 'force-dynamic'

/** Under an hour, so the console countdown ticks in minutes and seconds rather
 *  than sitting at "168h". */
const DEFAULT_VALIDITY_MS = 50 * 60 * 1000

export default async function NewMandatePage() {
  // Signing creates spending authority, so the studio is guarded like every
  // other owner-scoped screen. A form nobody can submit is a broken screen.
  await requireActor()

  // react-hooks/purity is written for client components, where re-rendering is
  // routine and reading the clock mid-render gives unstable output. A Server
  // Component renders once per request, and reading the clock once per request
  // is the whole point of this page.
  // eslint-disable-next-line react-hooks/purity
  const expiresAt = new Date(Date.now() + DEFAULT_VALIDITY_MS).toISOString()
  return <MandateStudio defaultExpiresAt={expiresAt} />
}
