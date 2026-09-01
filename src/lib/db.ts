import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@/generated/prisma/client'

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
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set (see .env.example)')
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
