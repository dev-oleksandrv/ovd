import { defineProject } from 'vitest/config'
import react from '@vitejs/plugin-react'

// .mts because @ovd/gui is not "type": "module": Vite would otherwise load this ESM file as CommonJS
// and warn on every run.
export default defineProject({
  plugins: [react()],
  test: {
    name: 'gui',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    // The default pool, set explicitly to silence Vitest's "jsdom was created N times" hint.
    // 'vmThreads' was measured (2026-11-05, 141 gui tests, 5 runs each): median 7.30 s vs 7.40 s
    // here, within noise. Not worth the vm-context caveats (Node globals from another realm).
    pool: 'forks',
    setupFiles: ['test/setup.ts']
  }
})
