import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type { ElectronApplication, Page } from '@playwright/test'
import { FAKE_CONSOLE_TOKEN } from '../fake-sdk/emulator.ts'
import { BURST_LINES, STICK_IP, VVD_VDA_SERIAL, bootIdAfter } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { expect, test } from '../harness/gui.ts'
import type { Sandbox } from '../harness/sandbox.ts'

const PLAYER = 'com.example.player'
const DEVICE = 'VirtualDevice'
const CLOSER = 'worker: idle'

// The Virtual Device with the player side-loaded (an app's lines) and the presets recording
// followed by the burst of BURST_LINES `com.example.player[31000]` lines in one device second.
test.use({
  world: {
    stick: null,
    vvd: { running: true, developerMode: true },
    installed: [{ device: 'VirtualDevice', package: 'player-aarch64-debug' }],
    logStream: { ends: false, holdAfterLine: null, recording: 'presets', burst: true }
  }
})

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

function toast(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text })
}

function rows(page: Page) {
  return page.getByRole('list', { name: 'Log lines' }).getByRole('listitem')
}

function presets(page: Page) {
  return page.getByRole('group', { name: 'Presets' })
}

function preset(page: Page, name: string) {
  return presets(page).getByRole('button', { name, exact: true })
}

function activeFilters(page: Page) {
  return page.getByRole('group', { name: 'Active filters' })
}

function ruleChips(page: Page) {
  return page.getByRole('group', { name: 'Process rules' })
}

async function openLogs(page: Page): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Logs' }).click()
  await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible()
}

// The closer line is the last of the stream: every line has arrived and Follow shows it.
async function streamed(page: Page): Promise<void> {
  await expect(rows(page).filter({ hasText: CLOSER })).toBeVisible({ timeout: 45_000 })
}

async function openFilters(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Filters/ }).click()
}

// The native save dialog can't be driven, so it answers with `file`.
async function saveAs(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, file)
}

// The window as small as the app lets the user drag it; the page has its new width on return.
async function shrinkWindow(app: ElectronApplication, page: Page): Promise<void> {
  const width = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('the app has no window')
    const [minWidth = 0, minHeight = 0] = win.getMinimumSize()
    win.setContentSize(minWidth, minHeight)
    return minWidth
  })
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
}

// The names of the saved filters, as the CLI lists them: the desktop and the CLI share the store.
async function savedNames(sandbox: Sandbox): Promise<string[]> {
  const run = await ovd(sandbox, ['logs', 'filter', 'list', '--json'])
  expect(run.exitCode).toBe(0)
  return run.json<{ filters: { name: string }[] }>().filters.map((f) => f.name)
}

// Each entry of a zip: its name and bytes, read from the central directory (stored or deflated).
function unzip(file: string): Map<string, Buffer> {
  const zip = readFileSync(file)
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(end).toBeGreaterThanOrEqual(0)
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const out = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    const method = zip.readUInt16LE(at + 10)
    const size = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const extraLength = zip.readUInt16LE(at + 30)
    const commentLength = zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = zip.subarray(dataAt, dataAt + size)
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data))
    at += 46 + nameLength + extraLength + commentLength
  }
  return out
}

test.describe('Logs power tools', () => {
  test('each preset narrows the list; an edit shows Custom; Save filter is off while a preset is shown', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await openLogs(page)
    await streamed(page)
    await expect(preset(page, 'All')).toHaveAttribute('aria-pressed', 'true')
    await expect(presets(page).getByText('Custom')).toHaveCount(0)
    await expect(presets(page).getByRole('button', { name: 'Save filter' })).toBeDisabled()
    await expect(echo(page)).toContainText(`ovd logs --device ${DEVICE}`)
    await expect(echo(page)).not.toContainText('--preset')

    await preset(page, 'Network').click()
    await expect(preset(page, 'Network')).toHaveAttribute('aria-pressed', 'true')
    await expect(preset(page, 'All')).toHaveAttribute('aria-pressed', 'false')
    await expect(echo(page)).toContainText(`ovd logs --preset network --device ${DEVICE}`)
    await expect(rows(page).filter({ hasText: CLOSER })).toHaveCount(0)
    await expect(rows(page).filter({ hasText: 'player burst' })).toHaveCount(0)
    await expect(rows(page).first()).toBeVisible()

    await preset(page, 'Lifecycle').click()
    await expect(preset(page, 'Lifecycle')).toHaveAttribute('aria-pressed', 'true')
    await expect(echo(page)).toContainText(`ovd logs --preset lifecycle --device ${DEVICE}`)
    await expect(rows(page).filter({ hasText: 'player burst' })).toHaveCount(0)
    await expect(rows(page).first()).toBeVisible()

    await preset(page, 'All').click()
    await streamed(page)
    await expect(echo(page)).not.toContainText('--preset')

    // An edit by hand matches no preset: Custom, and Save filter is on.
    await page.getByRole('textbox', { name: 'Search logs' }).fill('burst')
    await expect(presets(page).getByText('Custom')).toBeVisible()
    await expect(presets(page).getByText('Custom')).toHaveAttribute('aria-current', 'true')
    for (const name of ['All', 'App errors only', 'Network', 'Lifecycle']) {
      await expect(preset(page, name)).toHaveAttribute('aria-pressed', 'false')
    }
    await expect(presets(page).getByRole('button', { name: 'Save filter' })).toBeEnabled()
    await expect(echo(page)).toContainText('--grep "burst"')
  })

  // Main resets the list at once, while the side-loaded apps are still unknown to core; core reads
  // them afterwards and tells main (`onRefilter`), which resets again with the apps' lines.
  test('App errors only shows the side-loaded app’s error lines and no system line', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await openLogs(page)
    await streamed(page)

    await preset(page, 'App errors only').click()

    await expect(preset(page, 'App errors only')).toHaveAttribute('aria-pressed', 'true')
    await expect(echo(page)).toContainText(`ovd logs --preset app-errors --device ${DEVICE}`)
    // The player's error lines (the recording's `ERROR` lines of com.example.player) show...
    await expect(rows(page).filter({ hasText: 'Request could not resolve host' })).toBeVisible()
    await expect(rows(page).filter({ hasText: 'fetch failed' })).toBeVisible()
    // ...and no system line, no non-error app line (the burst and the ticks are INFO).
    await expect(rows(page).filter({ hasText: 'lcm_service' })).toHaveCount(0)
    await expect(rows(page).filter({ hasText: 'pkgmgrd' })).toHaveCount(0)
    await expect(rows(page).filter({ hasText: 'player burst' })).toHaveCount(0)
    await expect(rows(page).filter({ hasText: 'player tick' })).toHaveCount(0)
    await expect(rows(page).filter({ hasText: CLOSER })).toHaveCount(0)
  })

  test('Save filter names the filter and shows its command; it survives a restart, is applied, then deleted', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const first = await launch()
    const { page } = first
    await openLogs(page)
    await streamed(page)
    await page.getByRole('textbox', { name: 'Search logs' }).fill('burst')
    await expect(presets(page).getByText('Custom')).toBeVisible()

    await presets(page).getByRole('button', { name: 'Save filter' }).click()
    const dialog = page.getByRole('dialog', { name: 'Save filter' })
    await expect(dialog.getByText('ovd logs filter save <name> --grep "burst"')).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Filter name' }).fill('Bad Name')
    await expect(dialog.getByRole('alert')).toContainText('lower-case')
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await dialog.getByRole('textbox', { name: 'Filter name' }).fill('network')
    await expect(dialog.getByRole('alert')).toContainText('built-in preset')
    await dialog.getByRole('textbox', { name: 'Filter name' }).fill('burst-only')
    await expect(dialog.getByText('ovd logs filter save burst-only --grep "burst"')).toBeVisible()
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()

    await expect(dialog).toHaveCount(0)
    await expect(toast(page, 'Saved the filter burst-only')).toBeVisible()
    await expect(toast(page, 'ovd logs filter save burst-only --grep "burst"')).toBeVisible()
    // The filter now equals a saved one: its chip is on.
    await expect(preset(page, 'burst-only')).toHaveAttribute('aria-pressed', 'true')
    await expect(echo(page)).toContainText('ovd logs filter save burst-only --grep "burst"')
    expect(await savedNames(sandbox)).toEqual(['burst-only'])
    await expect(presets(page).getByRole('button', { name: 'Save filter' })).toBeDisabled()

    // The same name asks to Replace.
    await preset(page, 'All').click()
    await page.getByRole('textbox', { name: 'Search logs' }).fill('burst 1')
    await presets(page).getByRole('button', { name: 'Save filter' }).click()
    await dialog.getByRole('textbox', { name: 'Filter name' }).fill('burst-only')
    await expect(dialog.getByRole('button', { name: 'Replace' })).toBeVisible()
    await expect(dialog.getByText('--force')).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toHaveCount(0)

    await first.quit()
    const second = await launch()
    await openLogs(second.page)
    await streamed(second.page)
    await expect(preset(second.page, 'burst-only')).toBeVisible()
    await preset(second.page, 'burst-only').click()
    await expect(preset(second.page, 'burst-only')).toHaveAttribute('aria-pressed', 'true')
    await expect(echo(second.page)).toContainText(`ovd logs --preset burst-only --device ${DEVICE}`)
    await expect(second.page.getByRole('textbox', { name: 'Search logs' })).toHaveValue('burst')
    await expect(second.page.getByText('Custom')).toHaveCount(0)
    await expect(rows(second.page).filter({ hasText: 'player burst' }).first()).toBeVisible()
    await expect(rows(second.page).filter({ hasText: CLOSER })).toHaveCount(0)

    await second.page.getByRole('button', { name: 'Delete saved filter burst-only' }).click()
    await expect(preset(second.page, 'burst-only')).toHaveCount(0)
    await expect(toast(second.page, 'Deleted the saved filter burst-only')).toBeVisible()
    await expect(toast(second.page, 'ovd logs filter rm burst-only')).toBeVisible()
    await expect(echo(second.page)).toContainText('ovd logs filter rm burst-only')
    expect(await savedNames(sandbox)).toEqual([])
    // The filter on screen stays; it is no preset now.
    await expect(presets(second.page).getByText('Custom')).toBeVisible()
  })

  test('a PID from the Filters popover narrows the list and shows its chip and command', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await openLogs(page)
    await streamed(page)

    await openFilters(page)
    await page.getByRole('textbox', { name: 'PID', exact: true }).fill('x')
    await page.getByRole('button', { name: 'Add PID' }).click()
    await expect(page.getByRole('alert')).toContainText('non-negative whole number')
    await page.getByRole('textbox', { name: 'PID', exact: true }).fill('31000')
    await page.getByRole('button', { name: 'Add PID' }).click()

    await expect(page.getByRole('button', { name: 'Filters (1)' })).toBeVisible()
    await expect(activeFilters(page).getByText('PID 31000')).toBeVisible()
    await expect(echo(page)).toContainText(`ovd logs --pid 31000 --device ${DEVICE}`)
    await expect(presets(page).getByText('Custom')).toBeVisible()
    await expect(rows(page).filter({ hasText: 'player burst 50' })).toBeVisible()
    await expect(rows(page).filter({ hasText: CLOSER })).toHaveCount(0)
    for (const row of await rows(page).all()) await expect(row).toContainText('player burst')

    await activeFilters(page).getByRole('button', { name: 'Remove PID 31000' }).click()
    await expect(activeFilters(page)).toHaveCount(0)
    await expect(echo(page)).not.toContainText('--pid')
    await streamed(page)
  })

  // A window narrower than the default has no room for the popover to the right of its button
  // (a 1024 px wide screen, as the macOS CI runner's, gives such a window). It used to run past
  // the window's edge: a field typed in scrolled the screen sideways, and the next click outside
  // only closed the popover, the screen jumping back under the pointer.
  test('in the smallest window the Filters popover stays inside it, and one click outside acts', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { app, page } = await launch()
    await shrinkWindow(app, page)
    await openLogs(page)
    await streamed(page)

    await openFilters(page)
    for (const name of ['Add PID', 'Add Identity', 'Add boot', 'This boot']) {
      await expect(page.getByRole('button', { name })).toBeInViewport({ ratio: 1 })
    }
    await page.getByRole('textbox', { name: 'PID', exact: true }).fill('31000')
    await page.getByRole('button', { name: 'Add PID' }).click()
    await expect(activeFilters(page).getByText('PID 31000')).toBeVisible()
    await expect(echo(page)).toContainText(`ovd logs --pid 31000 --device ${DEVICE}`)
    // The screen didn't scroll sideways: its heading and the new chip are in the window.
    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeInViewport({ ratio: 1 })
    await expect(activeFilters(page).getByText('PID 31000')).toBeInViewport({ ratio: 1 })

    // One click outside the popover closes it and still does its own job.
    await activeFilters(page).getByRole('button', { name: 'Remove PID 31000' }).click()
    await expect(page.getByRole('textbox', { name: 'PID', exact: true })).toHaveCount(0)
    await expect(activeFilters(page)).toHaveCount(0)
    await expect(echo(page)).not.toContainText('--pid')
    await streamed(page)
  })

  test('This boot keeps the lines of the current boot, and the chip comes off again', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await openLogs(page)
    await streamed(page)

    await openFilters(page)
    await page.getByRole('textbox', { name: 'Boot ID' }).fill('nope')
    await page.getByRole('button', { name: 'Add boot' }).click()
    await expect(page.getByRole('alert')).toContainText('32 hex characters')
    await page.getByRole('button', { name: 'This boot' }).click()

    await expect(activeFilters(page).getByText('This boot')).toBeVisible()
    await expect(echo(page)).toContainText(`ovd logs --boot current --device ${DEVICE}`)
    // The boot ID is read from the device once, and every line of the stream is of this boot.
    await expect(rows(page).filter({ hasText: CLOSER })).toBeVisible()
    expect(sandbox.calls().some((c) => c.endsWith('cat /proc/sys/kernel/random/boot_id'))).toBe(
      true
    )

    await activeFilters(page).getByRole('button', { name: 'Remove This boot' }).click()
    await expect(activeFilters(page)).toHaveCount(0)

    // Another boot's ID is a filter too: no line is of it.
    await openFilters(page)
    await page.getByRole('textbox', { name: 'Boot ID' }).fill(bootIdAfter(1))
    await page.getByRole('button', { name: 'Add boot' }).click()
    await expect(echo(page)).toContainText(`--boot ${bootIdAfter(1)}`)
    await expect(page.getByText('No lines match the filter')).toBeVisible()
    await page.getByRole('button', { name: 'Reset to All' }).click()
    await streamed(page)
    await expect(activeFilters(page)).toHaveCount(0)
  })

  test('the process menu mutes a process; Level for and Limit set a rule each, with the OVD line for a limit', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await openLogs(page)
    await streamed(page)
    const menuFor = (identity: string) => page.getByRole('menu', { name: `Process ${identity}` })

    // Limit: the burst shows 5 lines of the second, the rest are counted in an OVD line.
    await page
      .getByRole('button', { name: `Process menu for ${PLAYER}` })
      .last()
      .click()
    await menuFor(PLAYER)
      .getByRole('menuitem', { name: `Limit ${PLAYER}…` })
      .click()
    await menuFor(PLAYER).getByRole('textbox', { name: 'Lines per second' }).fill('0')
    await menuFor(PLAYER).getByRole('button', { name: 'Limit' }).click()
    await expect(menuFor(PLAYER).getByRole('alert')).toBeVisible()
    await menuFor(PLAYER).getByRole('textbox', { name: 'Lines per second' }).fill('5')
    await menuFor(PLAYER).getByRole('button', { name: 'Limit' }).click()

    await expect(menuFor(PLAYER)).toHaveCount(0)
    await expect(ruleChips(page).getByText(`${PLAYER} limited to 5/s`)).toBeVisible()
    await expect(echo(page)).toContainText(`--process-rate ${PLAYER}=5`)
    await expect(
      rows(page).filter({ hasText: `${PLAYER}: ${BURST_LINES - 5} lines hidden by rate limit` })
    ).toBeVisible()
    await expect(rows(page).filter({ hasText: 'player burst 5' })).toBeVisible()
    await expect(rows(page).filter({ hasText: 'player burst 6' })).toHaveCount(0)

    // Level for: the player's lines at Warn and above.
    await page
      .getByRole('button', { name: `Process menu for ${PLAYER}` })
      .last()
      .click()
    await menuFor(PLAYER)
      .getByRole('menuitem', { name: `Level for ${PLAYER}…` })
      .click()
    await menuFor(PLAYER).getByRole('menuitem', { name: 'Warn and above' }).click()
    await expect(ruleChips(page).getByText(`${PLAYER} at W+`)).toBeVisible()
    await expect(echo(page)).toContainText(`--process-level ${PLAYER}=W`)
    await expect(echo(page)).toContainText(`--process-rate ${PLAYER}=5`)

    // Mute: a right click on a row of the process; no OVD rate line comes with it.
    await ruleChips(page)
      .getByRole('button', { name: `Remove ${PLAYER} at W+` })
      .click()
    await ruleChips(page)
      .getByRole('button', { name: `Remove ${PLAYER} limited to 5/s` })
      .click()
    await expect(ruleChips(page)).toHaveCount(0)
    await rows(page).filter({ hasText: 'player burst' }).last().click({ button: 'right' })
    await menuFor(PLAYER)
      .getByRole('menuitem', { name: `Mute ${PLAYER}` })
      .click()

    await expect(ruleChips(page).getByText(`Muted ${PLAYER}`)).toBeVisible()
    await expect(echo(page)).toContainText(`--mute ${PLAYER}`)
    await expect(rows(page).filter({ hasText: 'player burst' })).toHaveCount(0)
    await expect(rows(page).filter({ hasText: 'lines hidden by rate limit' })).toHaveCount(0)
    await expect(rows(page).filter({ hasText: CLOSER })).toBeVisible()

    await ruleChips(page)
      .getByRole('button', { name: `Remove Muted ${PLAYER}` })
      .click()
    await expect(ruleChips(page)).toHaveCount(0)
    await expect(rows(page).filter({ hasText: 'player burst' }).first()).toBeVisible()
  })

  test('Bundle saves a zip through the save dialog with its six files, a manifest and the CLI command', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { app, page } = await launch()
    const file = join(sandbox.home, 'player-burst.zip')
    await saveAs(app, file)
    await openLogs(page)
    await streamed(page)
    await openFilters(page)
    await page.getByRole('textbox', { name: 'PID', exact: true }).fill('31000')
    await page.getByRole('button', { name: 'Add PID' }).click()
    await expect(activeFilters(page).getByText('PID 31000')).toBeVisible()
    await expect(rows(page).filter({ hasText: 'player burst 50' })).toBeVisible()

    await page.getByRole('button', { name: 'Bundle', exact: true }).click()

    // The bundle reads the device's apps and crashes first: slow on a busy machine.
    await expect(toast(page, `Bundled ${BURST_LINES} lines to ${file}.`)).toBeVisible({
      timeout: 45_000
    })
    await expect(toast(page, 'Reveal')).toBeVisible()
    await expect(toast(page, `ovd logs bundle --device ${DEVICE} --pid 31000`)).toBeVisible()
    await expect(echo(page)).toContainText(`ovd logs bundle --device ${DEVICE} --pid 31000`)

    expect(existsSync(file)).toBe(true)
    const entries = unzip(file)
    expect([...entries.keys()].sort()).toEqual(
      ['README.txt', 'apps.json', 'crashes.json', 'logs.jsonl', 'logs.txt', 'manifest.json'].sort()
    )
    const manifest = JSON.parse(entries.get('manifest.json')?.toString('utf8') ?? '') as {
      format: number
      source: string
      lines: number
      ovd: string
      sdk: string
      createdAt: string
      device: { name: string; kind: string }
      timeRange: { from: string; to: string } | null
      filter: Record<string, unknown>
    }
    expect(manifest).toMatchObject({
      format: 1,
      source: 'buffer',
      lines: BURST_LINES,
      device: { name: 'Vega Virtual Device', kind: 'vvd' }
    })
    expect(manifest.ovd).toMatch(/^\d+\.\d+\.\d+/)
    expect(manifest.sdk).toMatch(/^\d+\.\d+/)
    expect(Number.isNaN(Date.parse(manifest.createdAt))).toBe(false)
    expect(manifest.timeRange?.from).toBeTruthy()
    expect(manifest.timeRange?.to).toBeTruthy()
    // OVD's own files hold no serial, IP, host path or console token; logs.txt and logs.jsonl are
    // the device's raw text (the documented exception, ADR 0026).
    const secrets = [
      VVD_VDA_SERIAL,
      STICK_IP,
      FAKE_CONSOLE_TOKEN,
      sandbox.home,
      sandbox.ovdHome,
      dirname(sandbox.home)
    ]
    for (const [name, data] of entries) {
      if (name === 'logs.txt' || name === 'logs.jsonl') continue
      for (const secret of secrets) expect(data.toString('utf8'), name).not.toContain(secret)
    }
    expect(JSON.stringify(manifest.filter)).toContain('31000')
    const jsonl = (entries.get('logs.jsonl')?.toString('utf8') ?? '').split('\n').filter(Boolean)
    expect(jsonl).toHaveLength(BURST_LINES)
    expect(entries.get('logs.txt')?.toString('utf8')).toContain('player burst 50')
    expect(sandbox.activity().filter((a) => a.action === 'logs.bundle')).toEqual([
      expect.objectContaining({ surface: 'desktop', result: 'ok' })
    ])
  })
})
