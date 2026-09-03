import { handlers } from '@/lib/auth/authjs'

/**
 * The OAuth callback surface. Auth.js owns everything here.
 *
 * With no provider credentials set the routes still exist and simply have no
 * provider to offer, which is what keeps a fresh clone runnable.
 */
export const { GET, POST } = handlers
