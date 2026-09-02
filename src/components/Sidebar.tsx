'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/**
 * Collapsible so Mission Control can take the full width during a run. Nav is
 * not part of the demo — once a mandate exists you never leave the console — so
 * the sidebar should be able to get out of the way.
 */

const NAV = [
  { href: '/console', label: 'Console', short: 'C' },
  { href: '/mandates/new', label: 'Mandate Studio', short: 'M' },
  { href: '/ledger', label: 'Audit Ledger', short: 'L' },
  { href: '/trust', label: 'Trust Report', short: 'T' },
] as const

export function Sidebar() {
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
          'border-b border-border flex items-center gap-2',
          collapsed ? 'px-3 py-4 justify-center' : 'px-5 py-4',
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

      <nav className={cn('flex-1 space-y-0.5', collapsed ? 'p-2' : 'p-2')}>
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

      {!collapsed && (
        <div className="px-5 py-4 border-t border-border text-[11px] text-muted-foreground font-mono">
          razorpay test mode
        </div>
      )}
    </aside>
  )
}
