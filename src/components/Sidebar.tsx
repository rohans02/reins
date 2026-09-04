'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  FileSignature,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  ShieldCheck,
  Store,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UserSwitcher, type DemoUser } from '@/components/UserSwitcher'
import { DEMO_USERS } from '@/lib/auth/users'
import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Collapsible so Mission Control can take the full width during a run. Nav is
 * not part of the demo — once a mandate exists you never leave the console — so
 * the sidebar should be able to get out of the way.
 *
 * Collapsed, each item is its icon rather than an initial. Letters are a poor
 * rail: "C" and "K" carry no meaning, and two items starting with the same
 * letter would collide. The icon plus the native tooltip does the job.
 *
 * It also carries live mandate state, fed from the layout. A judge glancing at
 * the left edge should be able to tell whether authority is in force without
 * reading the console.
 */

const NAV: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/console', label: 'Console', icon: Terminal },
  { href: '/mandates', label: 'Mandates', icon: Layers },
  { href: '/mandates/new', label: 'Mandate Studio', icon: FileSignature },
  { href: '/catalog', label: 'Catalog', icon: Store },
  { href: '/ledger', label: 'Audit Ledger', icon: ScrollText },
  { href: '/trust', label: 'Trust Report', icon: ShieldCheck },
]

/**
 * Combined authority across every LIVE mandate, not one mandate's state.
 *
 * With concurrent mandates the newest one understates what an agent could
 * spend. A rail that quietly under-reports exposure is worse than one showing
 * nothing, so this is deliberately the sum.
 */
export interface SidebarAuthority {
  liveCount: number
  everSigned: number
  authorizedPaise: number
  totalCapPaise: number
  remainingPaise: number
  anyRevoked: boolean
}

/** Shared shape for the two small icon buttons, so hover reads as one system. */
const ICON_BUTTON =
  'flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function Sidebar({
  authority,
  dark,
  user,
  authEnabled,
  signOut,
}: {
  authority: SidebarAuthority
  dark: boolean
  /** Who the app is acting as, and whether that was proven or asserted. */
  user: DemoUser
  authEnabled: boolean
  /** Server Component carrying the sign-out action. */
  signOut: React.ReactNode
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={cn(
        'shrink-0 border-r border-border bg-sidebar flex flex-col transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-56',
      )}
    >
      <div
        className={cn(
          'border-b border-border flex items-center gap-1',
          collapsed ? 'px-4 py-4 justify-center' : 'px-4 py-4',
        )}
      >
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="font-semibold tracking-tight truncate">Reins</div>
            <div className="text-[11px] text-muted-foreground truncate">
              Agent spending, bounded
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={ICON_BUTTON}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>

      {/* Whose mandates are on screen. Everything below is scoped to them. */}
      <UserSwitcher
        user={user}
        users={DEMO_USERS}
        collapsed={collapsed}
        authEnabled={authEnabled}
        signOut={signOut}
      />

      {/* Live authority — how much could be spent right now, in total? */}
      <AuthorityStatus authority={authority} collapsed={collapsed} />

      <nav className={cn('flex-1 space-y-1', collapsed ? 'p-2' : 'p-2')}>
        {NAV.map((item) => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center rounded-md text-sm transition-colors',
                collapsed ? 'size-10 mx-auto justify-center' : 'gap-2.5 px-3 py-2',
                active
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      <div
        className={cn(
          'border-t border-border flex items-center gap-2',
          collapsed ? 'px-4 py-3 justify-center' : 'px-4 py-3',
        )}
      >
        {!collapsed && (
          <span className="flex-1 font-mono text-[11px] text-muted-foreground truncate">
            razorpay test mode
          </span>
        )}
        <ThemeToggle dark={dark} collapsed={collapsed} />
      </div>
    </aside>
  )
}

function AuthorityStatus({
  authority,
  collapsed,
}: {
  authority: SidebarAuthority
  collapsed: boolean
}) {
  const { liveCount, everSigned, authorizedPaise, totalCapPaise, remainingPaise } = authority
  const live = liveCount > 0

  if (collapsed) {
    return (
      <div className="flex justify-center py-3 border-b border-border">
        <span
          aria-hidden
          title={
            live
              ? `${liveCount} live ${liveCount === 1 ? 'mandate' : 'mandates'}, ${formatINR(remainingPaise)} spendable`
              : 'No live mandate'
          }
          className={cn(
            'inline-block size-2 rounded-full',
            live && 'bg-emerald-600',
            !live && authority.anyRevoked && 'bg-destructive',
            !live && !authority.anyRevoked && 'bg-muted-foreground/40',
          )}
        />
      </div>
    )
  }

  if (!live) {
    return (
      <div className="px-4 py-3 border-b border-border">
        <div className="text-[11px] text-muted-foreground">
          {everSigned === 0 ? 'No mandate' : 'Nothing live'}
        </div>
        <div className="text-xs mt-0.5">The agent can spend nothing.</div>
      </div>
    )
  }

  const pct = totalCapPaise > 0 ? Math.min(100, (authorizedPaise / totalCapPaise) * 100) : 0

  return (
    <div className="px-4 py-3 border-b border-border space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {liveCount === 1 ? 'Mandate' : `${liveCount} mandates`}
        </span>
        <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
          live
        </span>
      </div>

      <div className="font-mono text-xs tabular-nums">
        {formatINR(authorizedPaise)}
        <span className="text-muted-foreground"> / {formatINR(totalCapPaise)}</span>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-emerald-600 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* The number that matters once more than one mandate is live. */}
      <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
        {formatINR(remainingPaise)} spendable
      </div>
    </div>
  )
}
