import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'e2e-cli',
    include: ['cli/**/*.e2e.test.ts'],
    // Each test runs the built CLI several times, and some flows wait on SDK polls.
    testTimeout: 60_000
  }
})
