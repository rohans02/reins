import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // ONE file at a time.
    //
    // Most of this suite is pure and would parallelise happily, but
    // authorize.test.ts and webhook.test.ts both drive the real authorization
    // path against the one SQLite file, and the ledger appends behind an
    // in-process mutex that two workers do not share. Run in parallel they
    // intermittently fail on each other's rows — which showed up here exactly
    // once, passed on the retry, and would otherwise have been discovered
    // mid-demo.
    //
    // The whole suite is under two seconds, so serialising costs nothing worth
    // having and buys a result that means the same thing every time.
    fileParallelism: false,
  },
  resolve: {
    // Mirror the tsconfig "@/*" alias so tests import exactly like app code does.
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
})
