import { handlers } from '@/lib/auth/authjs'

/**
 * The OAuth callback surface. Auth.js owns everything here.
 */
export const { GET, POST } = handlers
