import type { Page } from '@playwright/test'
import { usbStick } from '../fake-sdk/world.ts'
import { expect, PALETTE_KEY, test } from '../harness/gui.ts'

async function runCommand(page: Page, query: string): Promise<void> {
  await page.keyboard.press(PALETTE_KEY)
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByRole('combobox', { name: 'Command' }).fill(query)
  await palette.getByRole('option', { name: query }).first().click()
  await expect(palette).toHaveCount(0)
}

test.use({ world: { stick: usbStick(), vvd: { running: true, developerMode: true } } })

test.describe('command palette', () => {
  test('goes to screens', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible()

    await runCommand(page, 'Go to Doctor')
    await expect(page.getByRole('heading', { name: 'Environment' })).toBeVisible()

    await runCommand(page, 'Go to Devices')
    await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible()
  })

  test('switches the target', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    // Both devices listed and online, so neither is the target on its own.
    await expect(
      page.getByRole('list', { name: 'Devices' }).getByRole('button', { name: /Online/ })
    ).toHaveCount(2)
    await expect(page.getByRole('button', { name: 'Target device' })).toContainText('No device')

    await runCommand(page, 'Switch target to Fire TV stick')

    await expect(page.getByRole('button', { name: 'Target device' })).toContainText('Fire TV stick')
    expect(sandbox.hostState()).toMatchObject({ target: 'G070000000000001' })
  })

  test('stops the Virtual Device', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await expect(
      page
        .getByRole('list', { name: 'Devices' })
        .getByRole('button', { name: /Vega Virtual Device.*Online/ })
    ).toBeVisible()
    // See devices.e2e.ts: let the launch doctor run finish before the Virtual Device stops.
    await expect
      .poll(() => sandbox.calls())
      .toContain('vega exec vda -s emulator-5554 shell vsm developer-mode')

    await runCommand(page, 'Stop Virtual Device')

    await expect(
      page.getByRole('status').filter({ hasText: 'Virtual Device stopped' })
    ).toBeVisible()
    expect(sandbox.world().vvd.running).toBe(false)
  })

  test('opens the wizards', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()

    await runCommand(page, 'Pair a device')
    await expect(page.getByRole('dialog', { name: 'Pair a device over Wi-Fi' })).toBeVisible()
    await page.keyboard.press('Escape')

    await runCommand(page, 'Set up a new stick')
    await expect(page.getByRole('dialog', { name: 'Set up a new stick' })).toBeVisible()
  })

  test('lists later screens without dead buttons', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()

    await runCommand(page, 'Logs')

    await expect(
      page.getByRole('status').filter({ hasText: 'Logs is coming in a later version' })
    ).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Logs' })
    ).toHaveCount(0)
  })
})
