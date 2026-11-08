import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { expect, test } from '../harness/gui.ts'

const LOG = `vega exec vda -s ${STICK_SERIAL} shell loggingctl log -f -o short_concise`
const ERRORS_CLI = 'ovd logs --app com.example.player --level error'

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

function toast(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text })
}

function rows(page: Page) {
  return page.getByRole('list', { name: 'Log lines' }).getByRole('listitem')
}

async function openLogs(page: Page): Promise<void> {
  await nav(page, 'Logs').click()
  await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible()
}

// Level E and the player: only its two `console.error` lines (stick-follow.txt:35, :185).
async function playerErrors(page: Page): Promise<void> {
  await page.getByRole('radio', { name: 'Error' }).click()
  await page.getByRole('combobox', { name: 'Package' }).selectOption('com.example.player')
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).filter({ hasText: 'player error tick' })).toHaveCount(2)
}

test.use({ world: { stick: usbStick() } })

test.describe('Logs', () => {
  test('follows the stick; level, package and search filter it; Clear empties it', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await openLogs(page)
    // The last line of the recorded window (stick-follow.txt:261), shown while following.
    await expect(rows(page).filter({ hasText: 'player flood 62' })).toBeVisible()
    await expect(echo(page)).toContainText(`ovd logs --device ${STICK_SERIAL}`)

    await playerErrors(page)
    await expect(echo(page)).toContainText(ERRORS_CLI)
    await expect(toast(page, ERRORS_CLI).last()).toBeVisible()

    await page.getByRole('textbox', { name: 'Search logs' }).fill('tick 2')
    await page.getByRole('button', { name: 'Regex' }).click()
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).locator('mark')).toHaveText('tick 2')
    await expect(echo(page)).toContainText(`${ERRORS_CLI} --grep "tick 2" --regex`)

    await page.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(rows(page)).toHaveCount(0)

    expect(sandbox.calls().filter((c) => c === LOG)).toHaveLength(1)
    const started = sandbox.activity().filter((a) => a.action === 'logs')
    expect(started).toEqual([
      expect.objectContaining({ surface: 'desktop', target: STICK_SERIAL, result: 'ok' })
    ])
  })

  test('Export saves the shown lines in the ovd logs format', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { app, page } = await launch()
    const file = join(sandbox.home, 'player-errors.txt')
    // The native save dialog can't be driven, so it answers with `file`.
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, file)
    await openLogs(page)
    await playerErrors(page)

    await page.getByRole('button', { name: 'Export' }).click()

    await expect(toast(page, `Exported 2 lines to ${file}`)).toBeVisible()
    const lines = readFileSync(file, 'utf8').split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[2]).toBe('')
    for (const [i, n] of [1, 2].entries()) {
      expect(lines[i]).toMatch(
        new RegExp(
          `^\\d{2}:\\d{2}:\\d{2}\\.\\d{3} E com\\.amazon\\.keplerscript +27178 \\[KeplerScript-JavaScript\\] player error tick ${n}$`
        )
      )
    }
  })

  test.describe('paused', () => {
    test.use({ world: { stick: usbStick(), logStream: { ends: false, holdAfterLine: 100 } } })

    test('Pause holds the list while lines arrive; "new lines" shows them', async ({
      sandbox,
      launch
    }) => {
      sandbox.installSdk()
      const { page } = await launch()
      await openLogs(page)
      await expect(rows(page).first()).toBeVisible()
      await expect(page.getByText(/^\d+ lines · \d+ errors?$/)).toBeVisible()

      await page.getByRole('button', { name: 'Pause' }).click()
      sandbox.update((w) => {
        w.logStream.holdAfterLine = null
      })

      const fresh = page.getByRole('button', { name: /^\d+ new lines?$/ })
      await expect(fresh).toBeVisible()
      await expect(page.getByText('243 lines', { exact: false })).toBeVisible()
      await expect(rows(page).filter({ hasText: 'player flood 62' })).toHaveCount(0)

      await fresh.click()
      await expect(rows(page).filter({ hasText: 'player flood 62' })).toBeVisible()
      await expect(fresh).toHaveCount(0)
    })
  })

  test('an unplugged target: Logs unavailable', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    // Remembered as the target, so it stays the target once it is gone.
    expect((await ovd(sandbox, ['target', 'set', STICK_SERIAL])).exitCode).toBe(0)
    const { page } = await launch()
    await expect(page.getByRole('button', { name: 'Target: Fire TV stick' })).toBeVisible()
    await openLogs(page)
    await expect(rows(page).first()).toBeVisible()

    sandbox.update((w) => {
      if (w.stick) w.stick.usbCable = false
    })

    await expect(page.getByText('Logs unavailable — Fire TV stick is offline')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Switch target' })).toBeVisible()
  })

  test.describe('ended', () => {
    test.use({ world: { stick: usbStick(), logStream: { ends: true, holdAfterLine: null } } })

    test('a stream that ends shows the error; Restart runs it again', async ({
      sandbox,
      launch
    }) => {
      sandbox.installSdk()
      const { page } = await launch()
      await openLogs(page)

      const error = page.getByRole('alert').filter({ hasText: 'Fire TV stick’s log stream ended' })
      await expect(error).toBeVisible()
      // The lines before the reboot stay (stick-follow-reboot.txt).
      await expect(page.getByText('20 lines', { exact: false })).toBeVisible()

      await error.getByRole('button', { name: 'Restart' }).click()

      await expect(toast(page, 'Restarted the log session on Fire TV stick')).toBeVisible()
      await expect(toast(page, `ovd logs --device ${STICK_SERIAL}`).first()).toBeVisible()
      await expect.poll(() => sandbox.calls().filter((c) => c === LOG)).toHaveLength(2)
    })
  })
})
