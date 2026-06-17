import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Shared defaults — inherited by both projects via `extends: true`.
    globals: true,
    setupFiles: ['@testing-library/jest-dom'],
    pool: 'threads',
    projects: [
      {
        // Node-environment suites (server/logic). No DOM, no lucide-react, so
        // they stay fully parallel with no special handling.
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          // Run node suites first, in their own group. Distinct groupOrder is
          // required because this project's worker count differs from jsdom's,
          // and it cleanly separates the fast node pass from the capped jsdom
          // pass so the two never compete for CPU.
          sequence: { groupOrder: 0 },
        },
      },
      {
        // Component suites that need a DOM.
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          // Pre-bundle lucide-react. v1.7.0 ships no `exports` map and no clean
          // per-icon subpath (only internal dist/esm/icons/* paths resolve), so
          // rather than deep-import internals we let the deps optimizer bundle
          // the barrel once. Cold transforms then hit a single optimized chunk
          // instead of crawling ~1900 icon modules — this is the root cause of
          // the earlier cold-cache transform storm that tripped the 60s
          // worker-response timeout.
          deps: {
            optimizer: {
              // Vitest 4 renamed the client/web optimizer key from `web` to
              // `client`.
              client: {
                enabled: true,
                include: ['lucide-react'],
              },
            },
          },
          // Guardrail: cap concurrency for the heavier jsdom suites so a cold
          // run doesn't launch all of them into CPU/IO starvation at once and
          // miss the worker-response timeout. Single-threaded already passed in
          // ~5.75s, so a modest cap is safe. Node suites remain unthrottled.
          // (Vitest 4 moved per-pool min/max threads to top-level maxWorkers/
          // minWorkers.)
          maxWorkers: 3,
          minWorkers: 1,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
})
