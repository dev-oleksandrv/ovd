import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { expect, PALETTE_KEY, test } from '../harness/gui.ts'
import { makeRecordedVpkg } from '../harness/project.ts'
import { stillRunning } from '../harness/sandbox.ts'

const LOG = `vega exec vda -s ${STICK_SERIAL} shell loggingctl log -f -o short_concise`
const ERRORS_CLI = 'ovd logs --app com.example.player --level error'
const VPKG = 'Downloads/player_armv7.vpkg'
const INSTALLED = 'Installed player_armv7.vpkg from the CLI'

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

// Picks a format from the toolbar's Export menu.
async function exportAs(page: Page, format: 'Plain text (.txt)' | 'JSON lines (.jsonl)') {
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('menu', { name: 'Export' }).getByRole('menuitem', { name: format }).click()
}

// The native save dialog can't be driven, so it answers with `file`.
async function saveAs(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, file)
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

  test('Export → Plain text saves the shown lines in the ovd logs format', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { app, page } = await launch()
    const file = join(sandbox.home, 'player-errors.txt')
    await saveAs(app, file)
    await openLogs(page)
    await playerErrors(page)

    await exportAs(page, 'Plain text (.txt)')

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
    // `--until` is the second error line's instant: the CLI command ends where the file does.
    await expect(echo(page)).toContainText(
      new RegExp(`${ERRORS_CLI} --until \\S+Z --export ${file} --device ${STICK_SERIAL}`)
    )
  })

  test('Export → JSON lines saves one --json line per shown entry, with its CLI echo', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { app, page } = await launch()
    const file = join(sandbox.home, 'player-errors.jsonl')
    await saveAs(app, file)
    await openLogs(page)
    await playerErrors(page)

    await exportAs(page, 'JSON lines (.jsonl)')

    await expect(toast(page, `Exported 2 lines to ${file}`)).toBeVisible()
    const lines = readFileSync(file, 'utf8').split('\n')
    expect(lines.at(-1)).toBe('')
    const entries = lines.slice(0, -1).map((l) => JSON.parse(l) as Record<string, unknown>)
    expect(entries.map((e) => e.message)).toEqual([
      '[KeplerScript-JavaScript] player error tick 1',
      '[KeplerScript-JavaScript] player error tick 2'
    ])
    for (const entry of entries) {
      expect(entry).toMatchObject({ level: 'E', process: 'com.example.player', pid: 27178 })
      expect(Object.keys(entry)).not.toContain('seq')
    }
    await expect(echo(page)).toContainText(
      new RegExp(
        `${ERRORS_CLI} --until \\S+Z --export ${file} --format jsonl --device ${STICK_SERIAL}`
      )
    )
    await expect(toast(page, `--export ${file} --format jsonl`)).toBeVisible()
    expect(sandbox.calls().filter((c) => c === LOG)).toHaveLength(1)
  })

  test('the palette exports the session main keeps while another screen is shown', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { app, page } = await launch()
    const file = join(sandbox.home, 'all.jsonl')
    await saveAs(app, file)
    await openLogs(page)
    // The last line of the recorded window: every line has arrived.
    await expect(rows(page).filter({ hasText: 'player flood 62' })).toBeVisible()
    await nav(page, 'Devices').click()
    await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible()

    await page.keyboard.press(PALETTE_KEY)
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await palette.getByRole('combobox', { name: 'Command' }).fill('Export logs as JSON lines')
    await palette.getByRole('option', { name: 'Export logs as JSON lines…' }).click()

    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible()
    const saved = toast(page, `lines to ${file}`)
    await expect(saved).toBeVisible()
    const count = Number(/Exported (\d+) lines/.exec((await saved.textContent()) ?? '')?.[1])
    const lines = readFileSync(file, 'utf8').split('\n').slice(0, -1)
    expect(lines).toHaveLength(count)
    expect(count).toBeGreaterThan(2)
    for (const line of lines) expect(() => JSON.parse(line) as unknown).not.toThrow()
    expect((JSON.parse(lines.at(-1) ?? '') as { message: string }).message).toContain(
      'player flood 62'
    )
    // Main kept the session: no second stream.
    expect(sandbox.calls().filter((c) => c === LOG)).toHaveLength(1)
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

  test('shows Starting the log session… while the target is resolved, then the lines', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await expect(page.getByRole('button', { name: 'Target: Fire TV stick' })).toBeVisible()
    // The doctor run at launch lists devices too; its sign-in probe is the run's last SDK call.
    await expect.poll(() => sandbox.calls()).toContain('vega devmode login --json')
    // Starting a session lists the devices again to find the target online.
    sandbox.update((w) => {
      w.hold = ['vega exec vda devices -l']
    })

    await openLogs(page)

    const starting = page
      .getByRole('status')
      .filter({ hasText: 'Starting the log session on Fire TV stick…' })
    await expect(starting).toBeVisible()
    expect(sandbox.calls()).not.toContain(LOG)

    sandbox.update((w) => {
      w.hold = []
    })

    await expect(rows(page).filter({ hasText: 'player flood 62' })).toBeVisible()
    await expect(starting).toHaveCount(0)
    expect(sandbox.calls().filter((c) => c === LOG)).toHaveLength(1)
  })

  test.describe('before the first line', () => {
    test.use({ world: { stick: usbStick(), logStream: { ends: false, holdAfterLine: 0 } } })

    test('shows Waiting for log lines until the stick logs one', async ({ sandbox, launch }) => {
      sandbox.installSdk()
      const { page } = await launch()
      await openLogs(page)

      const waiting = page.getByText('Waiting for log lines from Fire TV stick')
      await expect(waiting).toBeVisible()
      await expect(rows(page)).toHaveCount(0)
      await expect.poll(() => sandbox.calls()).toContain(LOG)

      sandbox.update((w) => {
        w.logStream.holdAfterLine = null
      })

      await expect(rows(page).filter({ hasText: 'player flood 62' })).toBeVisible()
      await expect(waiting).toHaveCount(0)
    })
  })

  test('a search with no hit: No lines match the filters; Clear filters shows them again', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await openLogs(page)
    await expect(rows(page).filter({ hasText: 'player flood 62' })).toBeVisible()

    await page.getByRole('textbox', { name: 'Search logs' }).fill('no such line')

    const none = page.getByText('No lines match the filters')
    await expect(none).toBeVisible()
    await expect(rows(page)).toHaveCount(0)
    await expect(echo(page)).toContainText('--grep "no such line"')

    await page.getByRole('button', { name: 'Clear filters' }).click()

    await expect(rows(page).filter({ hasText: 'player flood 62' })).toBeVisible()
    await expect(none).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Search logs' })).toHaveValue('')
    await expect(echo(page)).toContainText(`ovd logs --device ${STICK_SERIAL}`)
    await expect(echo(page)).not.toContainText('--grep')
  })

  test('quitting while Logs follows the stick leaves no log stream', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const desktop = await launch()
    await openLogs(desktop.page)
    await expect(rows(desktop.page).first()).toBeVisible()
    await expect.poll(() => sandbox.logStreamPids().length).toBeGreaterThan(0)

    await desktop.quit()

    await expect.poll(() => stillRunning(sandbox.logStreamPids())).toEqual([])
  })

  test('an unplugged target: Logs unavailable', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    // Remembered as the target, so it stays the target once it is gone.
    expect((await ovd(sandbox, ['target', 'set', STICK_SERIAL])).exitCode).toBe(0)
    const { page } = await launch()
    const target = page.getByRole('button', { name: 'Target: Fire TV stick' })
    await expect(target).toBeVisible()
    // Unplugged before Logs opens: a running session would keep its list (AC 14).
    sandbox.update((w) => {
      if (w.stick) w.stick.usbCable = false
    })
    await expect(target).toContainText('Offline')
    await openLogs(page)

    await expect(page.getByText('Logs unavailable — Fire TV stick is offline')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Switch target' })).toBeVisible()
    expect(sandbox.calls().filter((c) => c === LOG)).toHaveLength(0)
  })

  test.describe('restart after install', () => {
    test.use({ world: { stick: usbStick(), logStream: { ends: false, holdAfterLine: 100 } } })

    test('an install from the CLI adds Installed and Log session restarted, and lines keep arriving', async ({
      sandbox,
      launch
    }) => {
      sandbox.installSdk()
      makeRecordedVpkg(sandbox.home, VPKG, 'player-armv7-release')
      const { page } = await launch()
      await openLogs(page)
      await expect(rows(page).first()).toBeVisible()

      expect((await ovd(sandbox, ['install', `~/${VPKG}`])).exitCode).toBe(0)

      await expect(rows(page).filter({ hasText: INSTALLED })).toBeVisible()
      await expect(rows(page).filter({ hasText: 'Log session restarted' })).toBeVisible()
      sandbox.update((w) => {
        w.logStream.holdAfterLine = null
      })
      await expect(rows(page).filter({ hasText: 'player flood 62' })).toBeVisible()
      expect(sandbox.calls().filter((c) => c === LOG)).toHaveLength(2)
      expect(sandbox.activity().filter((a) => a.action === 'logs.restart')).toEqual([
        expect.objectContaining({
          surface: 'desktop',
          target: STICK_SERIAL,
          args: { reason: 'install' },
          result: 'ok'
        })
      ])
    })

    test('the footer toggle off: the echo shows --no-restart-after-install and an install starts no stream', async ({
      sandbox,
      launch
    }) => {
      sandbox.installSdk()
      makeRecordedVpkg(sandbox.home, VPKG, 'player-armv7-release')
      const { page } = await launch()
      await openLogs(page)
      await expect(rows(page).first()).toBeVisible()
      await expect.poll(() => sandbox.logStreamPids()).toHaveLength(1)
      const [first = 0] = sandbox.logStreamPids()

      const toggle = page.getByRole('button', { name: 'Restart session after install' })
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await expect(echo(page)).toContainText(
        `ovd logs --no-restart-after-install --device ${STICK_SERIAL}`
      )
      await expect(toast(page, 'Restart session after install: off')).toBeVisible()

      expect((await ovd(sandbox, ['install', `~/${VPKG}`])).exitCode).toBe(0)

      await expect(rows(page).filter({ hasText: INSTALLED })).toBeVisible()
      // The session would SIGTERM the old stream right after it added the install line.
      expect(stillRunning([first])).toEqual([first])
      expect(sandbox.calls().filter((c) => c === LOG)).toHaveLength(1)
      expect(sandbox.activity().filter((a) => a.action === 'logs.restart')).toEqual([])
    })
  })

  test.describe('reboot', () => {
    test.use({
      world: { stick: usbStick(), logStream: { ends: false, holdAfterLine: null, reboot: true } }
    })

    test('a reboot: Reconnecting note while the stick is away, then Log session reconnected', async ({
      sandbox,
      launch
    }) => {
      sandbox.installSdk()
      // Remembered as the target, so it stays the target while it is away.
      expect((await ovd(sandbox, ['target', 'set', STICK_SERIAL])).exitCode).toBe(0)
      const { page } = await launch()
      await openLogs(page)

      const note = page.getByRole('status').filter({ hasText: 'Reconnecting to Fire TV stick…' })
      await expect(note).toBeVisible()
      await expect(page.getByText('Logs unavailable', { exact: false })).toHaveCount(0)
      await expect(note).toHaveCount(0)
      await expect(rows(page).filter({ hasText: 'player flood 62' })).toBeVisible()
      expect(sandbox.calls().filter((c) => c === LOG)).toHaveLength(2)
      // The list follows the new lines, so the OVD rows have scrolled away: a search keeps only
      // them (OVD lines match every filter).
      await page.getByRole('textbox', { name: 'Search logs' }).fill('no device line says this')
      await expect(rows(page)).toHaveCount(2)
      await expect(rows(page).nth(0)).toContainText('Device dropped · reconnecting…')
      await expect(rows(page).nth(1)).toContainText('Log session reconnected')
    })

    test('a reboot with no remembered target: the session stays, with its note, and reconnects', async ({
      sandbox,
      launch
    }) => {
      sandbox.installSdk()
      // Not remembered: the stick is the target only while it is the one online device, so the
      // target is gone while it reboots. Main keeps the session (it reconnects by itself).
      const { page } = await launch()
      await openLogs(page)

      const note = page.getByRole('status').filter({ hasText: 'Reconnecting to Fire TV stick…' })
      await expect(note).toBeVisible()
      await expect(page.getByText('No target device')).toHaveCount(0)
      await expect(note).toHaveCount(0)
      await expect(rows(page).filter({ hasText: 'player flood 62' })).toBeVisible()
      // One session throughout: the first stream and the reconnect, no fresh start.
      expect(sandbox.calls().filter((c) => c === LOG)).toHaveLength(2)
      await page.getByRole('textbox', { name: 'Search logs' }).fill('no device line says this')
      await expect(rows(page)).toHaveCount(2)
      await expect(rows(page).nth(1)).toContainText('Log session reconnected')
    })
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

      // Each stream ends at once: two reconnects, then the session gives up.
      const error = page.getByRole('alert').filter({ hasText: 'Fire TV stick’s log stream ended' })
      await expect(error).toBeVisible()
      // The lines before the reboot stay (stick-follow-reboot.txt), printed once.
      await expect(page.getByText('20 lines', { exact: false })).toBeVisible()
      expect(sandbox.calls().filter((c) => c === LOG)).toHaveLength(3)

      await error.getByRole('button', { name: 'Restart' }).click()

      await expect(toast(page, 'Restarted the log session on Fire TV stick')).toBeVisible()
      await expect(toast(page, `ovd logs --device ${STICK_SERIAL}`).first()).toBeVisible()
      // The new session's streams end at once too.
      await expect.poll(() => sandbox.calls().filter((c) => c === LOG).length).toBeGreaterThan(3)
    })

    test('an ended session whose target goes offline: Logs unavailable with why, then Restart once it is back', async ({
      sandbox,
      launch
    }) => {
      sandbox.installSdk()
      // Remembered as the target, so it stays the target once it is gone.
      expect((await ovd(sandbox, ['target', 'set', STICK_SERIAL])).exitCode).toBe(0)
      const { page } = await launch()
      await openLogs(page)
      const error = page.getByRole('alert').filter({ hasText: 'Fire TV stick’s log stream ended' })
      await expect(error).toBeVisible()

      sandbox.update((w) => {
        if (w.stick) w.stick.usbCable = false
      })

      await expect(page.getByText('Logs unavailable — Fire TV stick is offline')).toBeVisible()
      await expect(
        page.getByText('The last log session ended: Fire TV stick’s log stream ended')
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Restart', exact: true })).toHaveCount(0)

      sandbox.update((w) => {
        if (w.stick) w.stick.usbCable = true
      })

      await expect(error.getByRole('button', { name: 'Restart' })).toBeVisible()
    })
  })
})
