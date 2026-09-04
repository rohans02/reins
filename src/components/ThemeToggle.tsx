'use client'

import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'

/**
 * Light/dark toggle.
 */
export function ThemeToggle({ dark: initialDark }: { dark: boolean; collapsed?: boolean }) {
  const [dark, setDark] = useState(initialDark)

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    // One year, path-wide, Lax — this is a display preference, nothing sensitive.
    document.cookie = `rn-theme=${next ? 'dark' : 'light'}; path=/; max-age=31536000; SameSite=Lax`
  }

  return (
    <button
      onClick={toggle}
      title={dark ? 'Switch to light' : 'Switch to dark'}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      <span className="sr-only">Toggle theme</span>
    </button>
  )
}
