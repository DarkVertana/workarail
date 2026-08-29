import { defineConfig } from 'vitest/config'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Threads rather than forks: the suite is pure and does not need process
    // isolation, and forked workers cannot always be signalled in sandboxed
    // or containerised CI.
    pool: 'threads',
  },
  resolve: {
    alias: {
      '@': path.resolve(dir),
      // `server-only` exists to make a build fail if a module is pulled into a
      // client bundle. There is no bundle here, so point it at an empty module
      // rather than dropping the guard from the source.
      'server-only': path.resolve(dir, 'tests/stubs/server-only.ts'),
    },
  },
})
