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
import { AccountPanel } from '@/components/AccountPanel'
import { ThemeToggle } from '@/components/ThemeToggle'
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
 *
 * It shows THE MANDATE ON SCREEN, not a sum across every live one. A summed
 * figure disagreed with the meter beside it in the console, and two different
 * answers to "how much has been spent" on one screen is worse than one narrower
 * answer.
 *
 * Identity appears ONLY when OAuth is configured and somebody is actually signed
 * in. An earlier version announced "no login, demo identity" at all times, which
 * put the words "no login" at the top of the hero screen and read as an
 * unfinished auth system. A real session is the opposite case: hiding whose it
 * is, with no way to end it, is the gap.
 */

const NAV: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/console', label: 'Console', icon: Terminal },
  { href: '/mandates/new', label: 'Mandate Studio', icon: FileSignature },
  { href: '/mandates', label: 'Mandates', icon: Layers },
  { href: '/catalog', label: 'Catalog', icon: Store },
  { href: '/ledger', label: 'Audit Ledger', icon: ScrollText },
  { href: '/trust', label: 'Trust Report', icon: ShieldCheck },
]

/** The one mandate the console is working under. Null when none exists. */
export interface SidebarMandate {
  status: string
  authorizedPaise: number
  totalCapPaise: number
}

/** Shared shape for the two small icon buttons, so hover reads as one system. */
const ICON_BUTTON =
  'flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function Sidebar({
  mandate,
  dark,
  accountName,
}: {
  mandate: SidebarMandate | null
  dark: boolean
  /** Display name of the signed-in person, or null when OAuth is off. */
  accountName: string | null
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

      {accountName && <AccountPanel name={accountName} collapsed={collapsed} />}

      {/* Live mandate state — is authority in force right now? */}
      <MandateStatus mandate={mandate} collapsed={collapsed} />

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

function MandateStatus({
  mandate,
  collapsed,
}: {
  mandate: SidebarMandate | null
  collapsed: boolean
}) {
  const active = mandate?.status === 'ACTIVE'
  const revoked = mandate?.status === 'REVOKED'

  if (collapsed) {
    return (
      <div className="flex justify-center py-3 border-b border-border">
        <span
          aria-hidden
          title={mandate ? `Mandate ${mandate.status}` : 'No mandate'}
          className={cn(
            'inline-block size-2 rounded-full',
            active && 'bg-emerald-600',
            revoked && 'bg-destructive',
            !mandate && 'bg-muted-foreground/40',
          )}
        />
      </div>
    )
  }

  if (!mandate) {
    return (
      <div className="px-4 py-3 border-b border-border">
        <div className="text-[11px] text-muted-foreground">No mandate</div>
        <div className="text-xs mt-0.5">The agent can spend nothing.</div>
      </div>
    )
  }

  const pct =
    mandate.totalCapPaise > 0
      ? Math.min(100, (mandate.authorizedPaise / mandate.totalCapPaise) * 100)
      : 0

  return (
    <div className="px-4 py-3 border-b border-border space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">Mandate</span>
        <span
          className={cn(
            'font-mono text-[10px] font-semibold uppercase tracking-wide',
            active && 'text-emerald-600',
            revoked && 'text-destructive',
          )}
        >
          {mandate.status}
        </span>
      </div>

      <div className="font-mono text-xs tabular-nums">
        {formatINR(mandate.authorizedPaise)}
        <span className="text-muted-foreground"> / {formatINR(mandate.totalCapPaise)}</span>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full transition-[width] duration-300',
            revoked ? 'bg-muted-foreground' : 'bg-emerald-600',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
