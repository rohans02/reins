/**
 * The database URL, resolved in ONE place.
 *
 * Imported by both src/lib/db.ts (runtime) and prisma.config.ts (CLI). Two
 * copies of this default would drift, and the CLI and the app would quietly
 * talk to different files.
 *
 * Deliberately dependency-free: prisma.config.ts is loaded by the Prisma CLI in
 * a bare context, so this module must not pull in the client or the adapter.
 *
 * The fallback exists so `git clone && npm install && npm run dev` works before
 * anyone has written a .env. A set DATABASE_URL always wins.
 */
export const DEFAULT_DATABASE_URL = 'file:./prisma/dev.db'

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
}
