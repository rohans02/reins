import 'next-auth'

/**
 * The two fields the app adds to a session.
 *
 * `mandateUserId` is the only one that matters: it is what every owner-scoped
 * query filters by. It is `provider:providerAccountId` rather than an email,
 * because a mandate is authority over money and must not follow an address that
 * changed hands.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      mandateUserId?: string
      displayName?: string
    } & DefaultSession['user']
  }
}
