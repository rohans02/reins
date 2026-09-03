'use client'

import { useRouter } from 'next/navigation'
import { useTransition, type ReactNode } from 'react'
import { COOKIE_NAME } from '@/lib/auth/users'
import { cn } from '@/lib/utils'

/**
 * Who the app currently thinks you are.
 *
 * A DEMO INSTRUMENT, in the same spirit as FORCE_ATTEMPT, and labelled as one.
 * There is no login here, so this exists to make the tenancy boundary something
 * you can watch rather than something you have to be told about: switch person,
 * and the other one's mandates are gone from every screen, their ids stop
 * resolving, and their rows leave the ledger.
 *
 * Setting a cookie is obviously not authentication. Neither is typing a username
 * with no password, which is the point. The boundary being demonstrated is the
 * one that matters and is real: every query is filtered by owner and every write
 * checks ownership, server-side. Swapping this for a session changes one
 * function, `currentUserId`, and nothing else.
 */

/**
 * Written outside the component on purpose. React's immutability rule flags a
 * `document.cookie` assignment inside a component, and hoisting the write into
 * a plain function is both what the rule wants and clearer to read.
 */
function rememberUser(id: string) {
  // One year, path-wide, Lax. A demo identity, not a credential.
  document.cookie = `${COOKIE_NAME}=${id}; path=/; max-age=31536000; SameSite=Lax`
}

export interface DemoUser {
  id: string
  name: string
  authenticated?: boolean
}

export function UserSwitcher({
  user,
  users,
  collapsed,
  authEnabled,
  signOut,
}: {
  user: DemoUser
  users: DemoUser[]
  collapsed: boolean
  /** True when OAuth is configured, so the identity is proven rather than set. */
  authEnabled: boolean
  /** Server Component holding the sign-out action, or null when there is none. */
  signOut: ReactNode
}) {
  const router = useRouter()
  const [busy, startSwitch] = useTransition()

  function switchTo(id: string) {
    if (id === user.id) return
    rememberUser(id)
    // Every owner-filtered query lives in a Server Component, so switching
    // person means re-running them. A transition keeps the old screen up until
    // the new data lands rather than flashing an empty one, and it hands back
    // the pending flag without a second piece of state.
    startSwitch(() => router.refresh())
  }

  const initial = user.name.slice(0, 1).toUpperCase()

  if (collapsed) {
    return (
      <div className="flex justify-center py-3 border-b border-border">
        <span
          title={authEnabled ? `Signed in as ${user.name}` : `${user.name} (demo identity)`}
          className="flex size-7 items-center justify-center rounded-full bg-muted font-mono text-[11px] font-semibold"
        >
          {initial}
        </span>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 border-b border-border space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] font-semibold">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">{user.name}</div>
          <div className="text-[10px] text-muted-foreground truncate">
            {authEnabled ? 'signed in' : 'no login, demo identity'}
          </div>
        </div>
        {authEnabled && signOut}
      </div>

      {/* The switcher only makes sense when identity is asserted. Once it is
          proven, offering to become someone else would be a lie. */}
      {!authEnabled && (
        <div className={cn('flex gap-1', busy && 'opacity-50')}>
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => switchTo(u.id)}
              disabled={busy}
              title={`View as ${u.name}`}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-[10px] transition-colors',
                u.id === user.id
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
