import { requireActor } from '@/lib/auth/guard'
import { MandateStudio } from '@/components/MandateStudio'

/**
 * Mandate Studio — a thin Server Component around the studio form.
 *
 * It exists to own one value: the default expiry. The form used to derive it
 * from the clock while rendering, which meant the server pass and hydration
 * computed two different timestamps and React flagged a mismatch on every load.
 * Computed here, it is decided once and travels to the client as data.
 */

// The default expiry is relative to now, so this page must never be prerendered
// at build time — a baked-in timestamp would arrive already expired.
export const dynamic = 'force-dynamic'

/** Under an hour, so the console countdown ticks in minutes and seconds rather
 *  than sitting at "168h". */
const DEFAULT_VALIDITY_MS = 50 * 60 * 1000

export default async function NewMandatePage() {
  // Signing is the act that creates spending authority, so the studio is guarded
  // like every other owner-scoped screen. POST /api/mandates already refuses an
  // unauthenticated caller, but rendering the form to someone who cannot submit
  // it is a broken screen rather than a secure one.
  await requireActor()

  // react-hooks/purity is written for client components, where re-rendering is
  // routine and reading the clock mid-render gives unstable output. A Server
  // Component renders once per request, and reading the clock once per request
  // is the whole point of this page.
  // eslint-disable-next-line react-hooks/purity
  const expiresAt = new Date(Date.now() + DEFAULT_VALIDITY_MS).toISOString()
  return <MandateStudio defaultExpiresAt={expiresAt} />
}
