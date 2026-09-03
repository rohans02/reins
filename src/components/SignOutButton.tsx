import { LogOut } from 'lucide-react'
import { signOut } from '@/lib/auth/authjs'

/**
 * Sign out, as a POST through a Server Action.
 *
 * Not a link. A sign-out reachable by GET can be triggered by any page that
 * embeds the URL, which is a small thing but a real one, and Auth.js exposes a
 * server action precisely so it does not have to be.
 *
 * A Server Component passed into the client sidebar as a prop, which is what
 * lets a server action live inside an otherwise interactive panel.
 */
export function SignOutButton() {
  return (
    <form
      action={async () => {
        'use server'
        await signOut({ redirectTo: '/signin' })
      }}
    >
      <button
        type="submit"
        title="Sign out"
        aria-label="Sign out"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <LogOut className="size-3.5" />
      </button>
    </form>
  )
}
