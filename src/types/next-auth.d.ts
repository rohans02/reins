import 'next-auth'

/**
 * The two fields the app adds to a session.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      mandateUserId?: string
      displayName?: string
    } & DefaultSession['user']
  }
}
