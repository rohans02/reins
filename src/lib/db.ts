import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@/generated/prisma/client'
import { databaseUrl } from './db-url'

/**
 * Prisma 7 client singleton.
 *
 * Prisma 7 no longer reads the connection URL from schema.prisma — the URL lives
 * in prisma.config.ts for CLI commands, and the runtime client is constructed
 * with a driver adapter (better-sqlite3 here). The `globalThis` cache prevents
 * Next dev HMR from opening a new handle on every reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: databaseUrl() }) })
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
