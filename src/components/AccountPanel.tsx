import { LogOut } from 'lucide-react'
import { signOut } from '@/lib/auth/authjs'

/**
 * Who is signed in, and the way out.
 *
 * Rendered ONLY when OAuth is configured. An earlier version of this rail said
 * "no login, demo identity" whether or not anyone had signed in, which read as
 * an unfinished auth system sitting at the top of the hero screen. That text is
 * gone for good. This is the opposite case: a real session exists, so not
 * showing whose it is, and offering no way to end it, is the gap.
 *
 * Sign-out is a POST through a Server Action rather than a link, because a
 * sign-out reachable by GET can be triggered by any page that embeds the URL.
 * That is why this is a Server Component handed to the client sidebar as a prop.
 */
export function AccountPanel({ name, collapsed }: { name: string; collapsed: boolean }) {
  const initial = name.slice(0, 1).toUpperCase()

  const signOutForm = (
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
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <LogOut className="size-3.5" />
      </button>
    </form>
  )

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 py-3 border-b border-border">
        <span
          title={`Signed in as ${name}`}
          className="flex size-7 items-center justify-center rounded-full bg-muted font-mono text-[11px] font-semibold"
        >
          {initial}
        </span>
        {signOutForm}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] font-semibold">
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium truncate">{name}</div>
        <div className="text-[10px] text-muted-foreground truncate">signed in</div>
      </div>
      {signOutForm}
    </div>
  )
}
