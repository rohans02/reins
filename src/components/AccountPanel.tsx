'use client'

import { LogOut } from 'lucide-react'
import { signOutAction } from '@/lib/auth/actions'

/**
 * Who is signed in, and the way out.
 */
export function AccountPanel({ name, collapsed }: { name: string; collapsed: boolean }) {
  const initial = name.slice(0, 1).toUpperCase()

  if (collapsed) {
    return (
      <div className="flex justify-center py-3 border-t border-border">
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
    <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
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
