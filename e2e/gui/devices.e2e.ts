import type { Page } from '@playwright/test'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { expect, test } from '../harness/gui.ts'

function deviceRow(page: Page, name: RegExp) {
  return page.getByRole('list', { name: 'Devices' }).getByRole('button', { name })
}

function toast(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text })
}

test.describe('Devices', () => {
  test.use({ world: { stick: usbStick() } })

  test('lists the stick and the Virtual Device, and shows what the stick reports', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()

    await expect(deviceRow(page, /Fire TV stick.*USB · armv7 · OS 2\.0.*Online/)).toBeVisible()
    await expect(deviceRow(page, /Vega Virtual Device.*Stopped/)).toBeVisible()

    await deviceRow(page, /Fire TV stick/).click()
    const detail = page.locator('main')
    await expect(detail.getByText('TV Ship/529', { exact: true })).toBeVisible()
    await expect(detail.getByText('"product": "callie"')).toBeVisible()
    expect(sandbox.calls()).toContain(`vega device info --device ${STICK_SERIAL}`)
  })

  test('an unplugged stick leaves the list on the next refresh', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await expect(deviceRow(page, /Fire TV stick/)).toBeVisible()

    sandbox.update((w) => {
      if (w.stick) w.stick.usbCable = false
    })

    // "refreshes every 2 s": no Rescan needed.
    await expect(deviceRow(page, /Fire TV stick/)).toHaveCount(0, { timeout: 6_000 })
  })

  test('a stick plugged in without Developer Mode points to the setup wizard', async ({
    sandbox,
    launch
  }) => {
    sandbox.update((w) => {
      if (w.stick) w.stick.developerMode = false
    })
    sandbox.installSdk()
    const { page } = await launch()
    await expect(deviceRow(page, /Vega Virtual Device/)).toBeVisible()
    await expect(deviceRow(page, /Fire TV stick/)).toHaveCount(0)

    await page.getByRole('button', { name: /Stick plugged in but not listed\?/ }).click()

    await expect(page.getByRole('dialog', { name: 'Set up a new stick' })).toBeVisible()
  })

  test('renaming a stick keeps the name and echoes the command', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await deviceRow(page, /Fire TV stick/).click()

    await page.getByRole('button', { name: 'Rename' }).click()
    await page.getByRole('textbox', { name: 'Device name' }).fill('Living room stick')
    await page.keyboard.press('Enter')

    await expect(toast(page, 'Renamed to Living room stick')).toContainText(
      `$ ovd device rename ${STICK_SERIAL} "Living room stick"`
    )
    await expect(deviceRow(page, /Living room stick/)).toBeVisible()
    expect(sandbox.hostState()).toMatchObject({ names: { [STICK_SERIAL]: 'Living room stick' } })
  })

  test('Rescan lists again and echoes ovd devices', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await expect(deviceRow(page, /Fire TV stick/)).toBeVisible()

    await page.getByRole('button', { name: 'Rescan' }).click()

    await expect(toast(page, 'Rescanned · 2 devices')).toContainText('$ ovd devices')
  })
})

test.describe('target', () => {
  test.use({ world: { stick: usbStick(), vvd: { running: true, developerMode: true } } })

  test('picking a target updates the title bar and status bar, and is remembered', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const first = await launch()
    const page = first.page
    const picker = page.getByRole('button', { name: 'Target device' })
    // Two devices online: none is the target yet.
    await expect(picker).toContainText('No device')

    await picker.click()
    await page.getByRole('menuitemradio', { name: /Vega Virtual Device/ }).click()

    await expect(picker).toContainText('Vega Virtual Device')
    await expect(picker).toContainText('aarch64')
    await expect(page.getByRole('button', { name: 'Target: Vega Virtual Device' })).toBeVisible()
    await expect(page.getByTitle('Copy CLI equivalent')).toHaveText(
      /\$ ovd target set VirtualDevice/
    )
    await expect(deviceRow(page, /Vega Virtual Device.*Target/)).toBeVisible()
    expect(sandbox.hostState()).toMatchObject({ target: 'VirtualDevice' })

    // The CLI sees the same target, and so does the app after a restart.
    await first.quit()
    const again = await launch()
    await expect(again.page.getByRole('button', { name: 'Target device' })).toContainText(
      'Vega Virtual Device'
    )
  })

  test('Use as target on a device detail sets it', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await deviceRow(page, /Fire TV stick/).click()

    await page.getByRole('button', { name: 'Use as target' }).click()

    await expect(toast(page, 'Target: Fire TV stick')).toContainText(
      `$ ovd target set ${STICK_SERIAL}`
    )
    await expect(page.getByRole('button', { name: 'Use as target' })).toHaveCount(0)
  })

  test('a target that goes offline stays the target, shown offline', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await deviceRow(page, /Fire TV stick/).click()
    await page.getByRole('button', { name: 'Use as target' }).click()
    await expect(page.getByRole('button', { name: 'Target: Fire TV stick' })).toBeVisible()

    sandbox.update((w) => {
      if (w.stick) w.stick.usbCable = false
    })

    await expect(page.getByRole('button', { name: 'Target: Fire TV stick' })).toContainText(
      'Offline'
    )
    await expect(deviceRow(page, /Fire TV stick.*Target.*Offline/)).toBeVisible()
  })
})

test.describe('Virtual Device', () => {
  test('Start and Stop from its detail, with progress and the CLI echo', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await deviceRow(page, /Vega Virtual Device/).click()
    await expect(page.getByText('The Virtual Device is stopped.')).toBeVisible()
    // The doctor run at launch reads the Virtual Device's Developer Mode when it is online; a
    // stop right after a start could land between its list and that read, and VDA's answer for
    // a stopped Virtual Device isn't recorded. Its sign-in probe is the run's last SDK call.
    await expect.poll(() => sandbox.calls()).toContain('vega devmode login --json')

    await page.getByRole('button', { name: 'Start Virtual Device' }).click()

    await expect(toast(page, 'Virtual Device started')).toContainText('$ ovd vvd start')
    await expect(deviceRow(page, /Vega Virtual Device.*Online/)).toBeVisible()
    await expect(page.locator('main').getByText('aarch64').first()).toBeVisible()

    await page.getByRole('button', { name: 'Stop', exact: true }).click()

    await expect(toast(page, 'Virtual Device stopped')).toContainText('$ ovd vvd stop')
    await expect(deviceRow(page, /Vega Virtual Device.*Stopped/)).toBeVisible()
    expect(sandbox.activity().map((a) => a.action)).toEqual(['vvd.start', 'vvd.stop'])
    expect(sandbox.activity().every((a) => a.surface === 'desktop')).toBe(true)
  })

  test.describe('with Developer Mode off', () => {
    test.use({ world: { vvd: { running: true, developerMode: false } } })

    test('the detail turns it on', async ({ sandbox, launch }) => {
      sandbox.installSdk()
      const { page } = await launch()
      await deviceRow(page, /Vega Virtual Device/).click()
      await expect(page.getByText('Developer Mode is off on the Virtual Device.')).toBeVisible()

      await page.getByRole('button', { name: 'Enable Developer Mode' }).click()

      await expect(toast(page, 'Developer Mode on')).toContainText('$ ovd vvd devmode enable')
      await expect(page.getByText('Developer Mode is off on the Virtual Device.')).toHaveCount(0)
    })
  })
})
