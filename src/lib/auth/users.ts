/**
 * Identity constants, safe on both sides of the network.
 */

/** Matches `Mandate.userId`'s default, so existing rows belong to this user. */
export const DEFAULT_USER_ID = 'demo-user'

export const COOKIE_NAME = 'rn-user'

/**
 * The people the demo can act as. A real build reads this from a database.
 */
export const DEMO_USERS: Array<{ id: string; name: string }> = [
  { id: 'demo-user', name: 'Alice' },
  { id: 'second-user', name: 'Bob' },
]

export function isKnownUser(id: string): boolean {
  return DEMO_USERS.some((u) => u.id === id)
}

export function userName(id: string): string {
  return DEMO_USERS.find((u) => u.id === id)?.name ?? id
}
