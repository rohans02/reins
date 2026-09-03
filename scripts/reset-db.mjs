import fs from 'node:fs'

/**
 * Removes the SQLite file before `prisma db push` recreates it.
 *
 * `db:reset` is the command you run between demo takes, so when it fails it has
 * to say why. On Windows the file stays locked while `next dev` (or a stray node
 * process) holds it open, and the raw EBUSY stack trace is useless at 2am.
 */
const DB = 'prisma/dev.db'

try {
  fs.rmSync(DB, { force: true })
} catch (err) {
  if (err?.code === 'EBUSY' || err?.code === 'EPERM') {
    console.error(
      `\nCannot reset ${DB} — it is locked by another process.\n\n` +
        `Something still has the database open, almost always \`npm run dev\`.\n` +
        `Stop the dev server and run this again.\n`,
    )
    process.exit(1)
  }
  throw err
}
