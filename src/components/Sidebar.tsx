'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/console', label: 'Console' },
  { href: '/mandates/new', label: 'Mandate Studio' },
  { href: '/ledger', label: 'Audit Ledger' },
  { href: '/trust', label: 'Trust Report' },
] as const

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-sidebar flex flex-col">
      <div className="px-5 py-5 border-b border-border">
        <div className="font-semibold tracking-tight">MandateGuard</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          A Lakshman Rekha for AI agents
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-0.5">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'block rounded-md px-3 py-2 text-sm transition-colors',
              pathname === item.href
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-border text-xs text-muted-foreground font-mono">
        razorpay test mode
      </div>
    </aside>
  )
}
