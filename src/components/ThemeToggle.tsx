'use client'

import { useState } from 'react'

/**
 * Light/dark toggle.
 *
 * The class is applied before paint by an inline script in the layout, so there
 * is no flash of the wrong theme on load. This component only reflects and
 * flips it.
 *
 * The blueprint says record the demo in dark mode — it photographs better and
 * reads as a developer tool.
 */
export function ThemeToggle({ collapsed }: { collapsed: boolean }) {
  // Initialised from the DOM, which the inline script has already set. Reading
  // it lazily avoids both a hydration mismatch and a setState-in-effect.
  const [dark, setDark] = useState<boolean>(() =>
    typeof document === 'undefined' ? false : document.documentElement.classList.contains('dark'),
  )

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('mg-theme', next ? 'dark' : 'light')
    } catch {
      // Private browsing or blocked storage — the toggle still works for this session.
    }
  }

  return (
    <button
      onClick={toggle}
      title={dark ? 'Switch to light' : 'Switch to dark'}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
    >
      <span aria-hidden className="font-mono text-xs leading-none">
        {dark ? '☀' : '☾'}
      </span>
      {!collapsed && <span className="sr-only">Toggle theme</span>}
    </button>
  )
}
