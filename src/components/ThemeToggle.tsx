'use client'

import { useState } from 'react'

/**
 * Light/dark toggle.
 *
 * The current theme is a COOKIE, read by the server layout, which stamps the
 * `dark` class onto <html> during SSR. That matters for two reasons:
 *
 *   1. No hydration mismatch. This component is told the theme as a prop, so the
 *      server and client render identical markup. Reading the DOM in a lazy
 *      useState initialiser looks equivalent but is not — the server has no
 *      document, renders the light icon, and the client immediately disagrees.
 *   2. No inline script. The alternative is a blocking <script> in <head> to
 *      apply the class before paint, which React 19 warns about because scripts
 *      inside components never execute on client renders.
 *
 * The click flips the class immediately for instant feedback and writes the
 * cookie for the next server render, so there is no round-trip and no flash.
 */
export function ThemeToggle({ dark: initialDark }: { dark: boolean; collapsed?: boolean }) {
  const [dark, setDark] = useState(initialDark)

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    // One year, path-wide, Lax — this is a display preference, nothing sensitive.
    document.cookie = `mg-theme=${next ? 'dark' : 'light'}; path=/; max-age=31536000; SameSite=Lax`
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
      <span className="sr-only">Toggle theme</span>
    </button>
  )
}
