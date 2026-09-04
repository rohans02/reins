'use server'

import { signOut } from '@/lib/auth/authjs'

/**
 * Sign out, as a Server Action a client component can call.
 *
 * It lives in its own 'use server' module for one reason: the account panel has
 * to know whether the sidebar is collapsed, which is client state, so the panel
 * cannot itself be a Server Component. Extracting the action keeps sign-out a
 * POST rather than a link, which matters because a GET sign-out can be triggered
 * by any page that embeds the URL.
 */
export async function signOutAction() {
  await signOut({ redirectTo: '/signin' })
}
