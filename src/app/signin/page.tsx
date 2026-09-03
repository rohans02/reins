import { redirect } from 'next/navigation'
import { signIn } from '@/lib/auth/authjs'
import { configuredProviders } from '@/lib/auth/providers'
import { currentActor } from '@/lib/auth/session'
import { Button } from '@/components/ui/button'

/**
 * Sign in.
 *
 * Only reachable when OAuth is configured. With no provider credentials the app
 * runs on demo identities and nothing redirects here, so arriving anyway means
 * someone typed the URL — send them back rather than showing an empty page with
 * no way forward.
 *
 * Server Actions rather than a client component. The provider button posts, the
 * server starts the OAuth flow, and no part of this needs to run in the browser.
 */
export const dynamic = 'force-dynamic'

export default async function SignInPage() {
  const providers = configuredProviders()
  const actor = await currentActor()

  if (providers.length === 0 || actor) redirect('/console')

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">MandateGuard</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            A Lakshman Rekha for AI agents. Sign in to see the mandates you have signed and the
            money they bound.
          </p>
        </div>

        <div className="space-y-2">
          {providers.map((p) => (
            <form
              key={p.id}
              action={async () => {
                'use server'
                await signIn(p.id, { redirectTo: '/console' })
              }}
            >
              <Button type="submit" className="w-full h-10">
                Continue with {p.label}
              </Button>
            </form>
          ))}
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          Your mandates are yours. Every screen and every route is scoped to the account that
          signed them, and nothing else can read, revoke or spend them.
        </p>
      </div>
    </div>
  )
}
