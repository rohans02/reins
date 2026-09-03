'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Layers } from 'lucide-react'

/**
 * Which mandate the console is currently working under.
 *
 * A deliberately plain native select. A run binds to exactly one mandate, and
 * the control that chooses it should be the most boring, most predictable
 * element on the screen — this is not the place to demonstrate a custom
 * popover, and a native select is keyboard-accessible without any of the work.
 *
 * With a single mandate it collapses to a label. A dropdown offering one choice
 * is furniture, and the console is the one screen that has to stay quiet.
 */

export interface SwitchableMandate {
  id: string
  intentText: string
  live: boolean
}

/** Enough of the intent to tell two mandates apart, not enough to wrap. */
function shortLabel(m: SwitchableMandate): string {
  const text = m.intentText.trim() || m.id
  const clipped = text.length > 46 ? `${text.slice(0, 45).trimEnd()}…` : text
  return m.live ? clipped : `${clipped} (not live)`
}

export function MandateSwitcher({
  current,
  options,
}: {
  current: string
  options: SwitchableMandate[]
}) {
  const router = useRouter()

  if (options.length <= 1) {
    return (
      <Link
        href="/mandates"
        title="Manage mandates"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Layers className="size-3.5" />
        <span>1 mandate</span>
      </Link>
    )
  }

  const liveCount = options.filter((m) => m.live).length

  return (
    <div className="flex items-center gap-1.5">
      <Layers className="size-3.5 text-muted-foreground shrink-0" aria-hidden />
      <label className="sr-only" htmlFor="mandate-switcher">
        Mandate in use
      </label>
      <select
        id="mandate-switcher"
        value={current}
        onChange={(e) => router.push(`/console?mandate=${e.target.value}`)}
        className="max-w-[15rem] truncate rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {shortLabel(m)}
          </option>
        ))}
      </select>
      <span className="font-mono text-[10px] text-muted-foreground shrink-0 tabular-nums">
        {liveCount} live
      </span>
    </div>
  )
}
