'use client'

import { LogOut } from 'lucide-react'
import { signOutAction } from '@/lib/auth/actions'

/**
 * Who is signed in, and the way out.
 *
 * Rendered ONLY when OAuth is configured and a real session exists. An earlier
 * version of this rail said "no login, demo identity" whether or not anyone had
 * signed in, which read as an unfinished auth system at the top of the hero
 * screen. That text is gone for good. A real session is the opposite case:
 * hiding whose it is, with no way to end it, is the gap.
 *
 * A CLIENT component, because it has to know whether the sidebar is collapsed,
 * and that is client state. Sign-out therefore comes in as a Server Action from
 * `@/lib/auth/actions` rather than being defined inline, so it stays a POST.
 *
 * Collapsed, this is the avatar alone. A 64px rail has no room for a name, and
 * an unlabelled sign-out button sitting in it is a control nobody can identify
 * and everybody can hit by accident.
 */
export function AccountPanel({ name, collapsed }: { name: string; collapsed: boolean }) {
  const initial = name.slice(0, 1).toUpperCase()

  if (collapsed) {
    return (
      <div className="flex justify-center py-3 border-b border-border">
        <span
          title={`Signed in as ${name} — expand the sidebar to sign out`}
          className="flex size-7 items-center justify-center rounded-full bg-muted font-mono text-[11px] font-semibold"
        >
          {initial}
        </span>
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
      <form action={signOutAction}>
        <button
          type="submit"
          title="Sign out"
          aria-label="Sign out"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="size-3.5" />
        </button>
      </form>
    </div>
  )
}
