/**
 * Identity constants, safe on both sides of the network.
 *
 * Deliberately separate from `session.ts`. That module reads cookies, so it
 * imports `next/headers` and can only ever run on the server. The sidebar is a
 * client component and needs the list of people to render the switcher, and
 * importing it from the session module dragged server-only code into the
 * browser bundle and took every route down with a 500.
 *
 * The split is the rule worth keeping: WHO EXISTS is public data, WHO IS ASKING
 * is a server question.
 */

/** Matches `Mandate.userId`'s default, so existing rows belong to this user. */
export const DEFAULT_USER_ID = 'demo-user'

export const COOKIE_NAME = 'mg-user'

/**
 * The people the demo can act as. A real build reads this from a database.
 *
 * Alice and Bob on purpose. They are the standing placeholders for two parties
 * in a security argument, so nobody watching has to work out whether a name is
 * meaningful. The ids are unchanged: `demo-user` still matches the column
 * default, so every mandate signed before this existed still belongs to Alice.
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
