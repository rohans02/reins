import NextAuth, { type NextAuthConfig } from 'next-auth'
import GitHub from 'next-auth/providers/github'
import Google from 'next-auth/providers/google'
import { configuredProviders } from '@/lib/auth/providers'

/**
 * Auth.js wiring. Deliberately small, because the application asks exactly one
 * question of it and asks that question in exactly one place.
 */

const providers: NextAuthConfig['providers'] = []
for (const p of configuredProviders()) {
  if (p.id === 'github') {
    providers.push(
      GitHub({ clientId: process.env.AUTH_GITHUB_ID, clientSecret: process.env.AUTH_GITHUB_SECRET }),
    )
  }
  if (p.id === 'google') {
    providers.push(
      Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET }),
    )
  }
}

export const authConfig: NextAuthConfig = {
  providers,
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin' },
  trustHost: true,
  callbacks: {
    // Stamped once at sign-in and carried in the signed token thereafter, so
    // every later request resolves an owner with no database round trip.
    async jwt({ token, account, profile }) {
      if (account) {
        token.mandateUserId = `${account.provider}:${account.providerAccountId}`
        const name = (profile?.name ?? profile?.login ?? profile?.email) as string | undefined
        if (name) token.displayName = name
      }
      return token
    },
    async session({ session, token }) {
      session.user.mandateUserId = token.mandateUserId as string | undefined
      session.user.displayName = token.displayName as string | undefined
      return session
    },
  },
}

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig)
