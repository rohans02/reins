import 'dotenv/config'
import path from 'node:path'
import { defineConfig } from 'prisma/config'
import { databaseUrl } from './src/lib/db-url'

/**
 * Prisma 7 moved the connection URL out of schema.prisma and into this file.
 * The runtime client gets its connection via a driver adapter (see src/lib/db.ts).
 *
 * Note this does NOT use prisma/config's env() helper: env() throws when the
 * variable is unset, and the postinstall `prisma generate` runs before a fresh
 * clone has any .env — which made `npm ci` fail outright.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: { path: path.join('prisma', 'migrations') },
  datasource: { url: databaseUrl() },
})
