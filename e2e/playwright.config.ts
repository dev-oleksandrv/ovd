import { defineConfig } from '@playwright/test'

// The built desktop app against the fake SDK (ADR 0023). Each test launches its own Electron.
export default defineConfig({
  testDir: 'gui',
  testMatch: '*.e2e.ts',
  timeout: 60_000,
  // Device polls run every 2 s and each SDK call starts a process, so UI updates take seconds.
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  // A flaky flow is a bug to fix, not to retry.
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  outputDir: 'test-results'
})
