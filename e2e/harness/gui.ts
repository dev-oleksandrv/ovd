import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  _electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import type { World } from '../fake-sdk/world.ts'
import { openSandbox, type Sandbox } from './sandbox.ts'

const GUI = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/gui')
// The app electron-vite builds (`pnpm --filter @ovd/gui build`), not the dev server.
export const GUI_MAIN = join(GUI, 'out/main/index.js')
const ELECTRON = createRequire(join(GUI, 'package.json'))('electron') as string

export interface Desktop {
  app: ElectronApplication
  page: Page
  // URLs the app opened in the default browser (shell.openExternal is stubbed).
  opened(): Promise<string[]>
  // Quits the app, as the user would; launch() again to restart it on the same sandbox.
  quit(): Promise<void>
}

interface Fixtures {
  // The world the fake SDK starts with; set per file or test with test.use({ world }).
  world: Partial<World>
  sandbox: Sandbox
  launch: () => Promise<Desktop>
}

export const test = base.extend<Fixtures>({
  world: [{}, { option: true }],

  sandbox: async ({ world }, use) => {
    const sandbox = openSandbox(world)
    await use(sandbox)
    sandbox.close()
  },

  launch: async ({ sandbox }, use, testInfo) => {
    if (!existsSync(GUI_MAIN)) {
      throw new Error(
        `${GUI_MAIN} is missing: build the desktop app first (pnpm run test:e2e builds it)`
      )
    }
    const running: Desktop[] = []

    await use(async () => {
      const app = await _electron.launch({
        executablePath: ELECTRON,
        // Ubuntu runners don't allow Chromium's sandbox (unprivileged user namespaces).
        args: [GUI_MAIN, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
        env: sandbox.env
      })
      await app.context().tracing.start({ screenshots: true, snapshots: true })
      // Links open in the user's browser through shell.openExternal; record them instead.
      await app.evaluate(({ shell }) => {
        const opened: string[] = []
        Object.assign(globalThis, { __ovdOpened: opened })
        shell.openExternal = async (url: string) => {
          opened.push(url)
        }
      })
      const page = await app.firstWindow()
      const desktop: Desktop = {
        app,
        page,
        opened: () =>
          app.evaluate(() => (globalThis as unknown as { __ovdOpened: string[] }).__ovdOpened),
        quit: async () => {
          running.splice(running.indexOf(desktop), 1)
          await stop(app, testInfo.outputPath(`trace-${running.length}.zip`), false)
        }
      }
      running.push(desktop)
      return desktop
    })

    const failed = testInfo.status !== testInfo.expectedStatus
    for (const [i, desktop] of running.entries()) {
      await stop(desktop.app, testInfo.outputPath(`trace-${i}.zip`), failed)
    }
  }
})

async function stop(
  app: ElectronApplication,
  tracePath: string,
  keepTrace: boolean
): Promise<void> {
  await app.context().tracing.stop(keepTrace ? { path: tracePath } : {})
  await app.close()
}

export { expect }

// ⌘K on macOS, Ctrl+K on Ubuntu, as the app binds it.
export const PALETTE_KEY = process.platform === 'darwin' ? 'Meta+K' : 'Control+K'
