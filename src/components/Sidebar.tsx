'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ThemeToggle } from '@/components/ThemeToggle'
import { formatINR } from '@/lib/money'
import { cn } from '@/lib/utils'

/**
 * Collapsible so Mission Control can take the full width during a run. Nav is
 * not part of the demo — once a mandate exists you never leave the console — so
 * the sidebar should be able to get out of the way.
 *
 * It also carries live mandate state, fed from the layout. A judge glancing at
 * the left edge should be able to tell whether authority is currently in force
 * without reading the console.
 */

const NAV = [
  { href: '/console', label: 'Console', short: 'C' },
  { href: '/mandates/new', label: 'Mandate Studio', short: 'M' },
  { href: '/catalog', label: 'Catalog', short: 'K' },
  { href: '/ledger', label: 'Audit Ledger', short: 'L' },
  { href: '/trust', label: 'Trust Report', short: 'T' },
] as const

export interface SidebarMandate {
  status: string
  authorizedPaise: number
  totalCapPaise: number
}

export function Sidebar({
  mandate,
  dark,
}: {
  mandate: SidebarMandate | null
  dark: boolean
}) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={cn(
        'shrink-0 border-r border-border bg-sidebar flex flex-col transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-56',
      )}
    >
      <div
        className={cn(
          'border-b border-border flex items-center gap-1',
          collapsed ? 'px-2 py-4 justify-center' : 'px-4 py-4',
        )}
      >
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="font-semibold tracking-tight truncate">MandateGuard</div>
            <div className="text-[11px] text-muted-foreground truncate">
              A Lakshman Rekha for AI agents
            </div>
          </div>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
        >
          <span aria-hidden className="font-mono text-xs leading-none">
            {collapsed ? '»' : '«'}
          </span>
        </button>
      </div>

      {/* Live mandate state — is authority in force right now? */}
      <MandateStatus mandate={mandate} collapsed={collapsed} />

      <nav className="flex-1 p-2 space-y-0.5">
        {NAV.map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                'block rounded-md text-sm transition-colors',
                collapsed ? 'px-0 py-2 text-center font-mono' : 'px-3 py-2',
                active
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              {collapsed ? item.short : item.label}
            </Link>
          )
        })}
      </nav>

      <div
        className={cn(
          'border-t border-border flex items-center gap-2',
          collapsed ? 'px-2 py-3 justify-center' : 'px-4 py-3',
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
          title={mandate ? mandate.status : 'No mandate'}
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

  const pct = Math.min(100, (mandate.authorizedPaise / mandate.totalCapPaise) * 100)

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
          className={cn('h-full transition-[width] duration-300', revoked ? 'bg-muted-foreground' : 'bg-emerald-600')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
