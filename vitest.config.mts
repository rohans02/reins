import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    // Mirror the tsconfig "@/*" alias so tests import exactly like app code does.
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
})
