import 'server-only'

/**
 * Which sign-in providers are actually usable, decided by which secrets exist.
 */

export interface ConfiguredProvider {
  id: 'github' | 'google'
  label: string
}

function has(...names: string[]): boolean {
  return names.every((n) => (process.env[n] ?? '').trim().length > 0)
}

export function configuredProviders(): ConfiguredProvider[] {
  const out: ConfiguredProvider[] = []
  if (has('AUTH_GITHUB_ID', 'AUTH_GITHUB_SECRET')) out.push({ id: 'github', label: 'GitHub' })
  if (has('AUTH_GOOGLE_ID', 'AUTH_GOOGLE_SECRET')) out.push({ id: 'google', label: 'Google' })

  if (out.length > 0 && !has('AUTH_SECRET')) {
    warnOnce([
      'AUTH_SECRET is not set, so sign-in cannot work.',
      'Running on demo identities instead. To enable sign-in, put a secret in .env:',
      '    npx auth secret          (or)          openssl rand -hex 32',
    ])
    return []
  }

  return out
}

let warned = false
function warnOnce(lines: string[]) {
  if (warned) return
  warned = true
  console.warn(['', '[reins] ' + lines[0], ...lines.slice(1), ''].join('\n'))
}

/** True when sign-in is required. False means the demo identities are in use. */
export function authEnabled(): boolean {
  return configuredProviders().length > 0
}
