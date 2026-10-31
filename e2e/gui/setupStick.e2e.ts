import type { Page } from '@playwright/test'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { expect, test } from '../harness/gui.ts'

function wizard(page: Page) {
  return page.getByRole('dialog', { name: 'Set up a new stick' })
}

async function open(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Target device' }).click()
  await page.getByRole('menuitem', { name: 'Set up a new stick…' }).click()
  await expect(wizard(page)).toContainText('Step 1 of 4')
}

// A brand-new stick: plugged in, Developer Mode off, so VDA doesn't list it (ADR 0009).
test.use({
  world: { stick: usbStick({ developerMode: false }), account: 'signed-out', tvCode: 'ABC123' }
})

test.describe('Set up a new stick', () => {
  test('takes a new stick from not listed to listed on USB', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    const devices = page.getByRole('list', { name: 'Devices' })
    await expect(devices.getByRole('button', { name: /Vega Virtual Device/ })).toBeVisible()
    await expect(devices.getByRole('button', { name: /Fire TV stick/ })).toHaveCount(0)
    await open(page)
    const w = wizard(page)
    await expect(page.getByTitle('Copy CLI equivalent')).toHaveText(/\$ ovd setup-stick/)

    // 1. On the TV.
    await expect(w.getByText(/Select the device name 7 times/)).toBeVisible()
    await w.getByRole('button', { name: 'I see the code' }).click()

    // 2. Sign in: the link and code `vega devmode login` prints, then the browser sign-in.
    await expect(w).toContainText('Step 2 of 4')
    await w.getByRole('button', { name: 'Sign in' }).click()
    await expect(w.getByText('Signed in to Amazon Developer Services')).toBeVisible()
    await w.getByRole('button', { name: 'Continue' }).click()

    // 3. The code from the TV, typed loosely; the shown command is the one run.
    await expect(w).toContainText('Step 3 of 4')
    await w.getByRole('textbox', { name: 'Code from the TV' }).fill('abc-123')
    await expect(w.getByText('vega devmode enable-device --code ABC123')).toBeVisible()
    await w.getByRole('button', { name: 'Enable Developer Mode' }).click()
    await expect(w.getByText('The device is rebooting')).toBeVisible()
    expect(sandbox.calls()).toContain('vega devmode enable-device --code ABC123 --json')
    await w.getByRole('button', { name: 'Continue' }).click()

    // 4. Connect over USB: wait for the stick to come back after its reboot.
    await expect(w).toContainText('Step 4 of 4')
    await w.getByRole('radio', { name: /USB/ }).click()
    await expect(
      w.getByText(`Fire TV stick · ${STICK_SERIAL} · USB · armv7 — now in Devices`)
    ).toBeVisible()
    await w.getByRole('button', { name: 'Done' }).click()

    await expect(wizard(page)).toHaveCount(0)
    await expect(
      page.getByRole('status').filter({ hasText: 'Fire TV stick is ready' })
    ).toContainText('$ ovd setup-stick --code ABC123')
    await expect(devices.getByRole('button', { name: /Fire TV stick.*Online/ })).toBeVisible()
  })

  test('shows the sign-in link while it waits for the browser', async ({ sandbox, launch }) => {
    sandbox.update((w) => (w.browserSignIn = 'never'))
    sandbox.installSdk()
    const { page } = await launch()
    await open(page)
    const w = wizard(page)
    await w.getByRole('button', { name: 'I see the code' }).click()
    await w.getByRole('button', { name: 'Sign in' }).click()

    await expect(w.getByText('https://amazon.com/us/code?cbl-code=ABC123')).toBeVisible()
    await expect(w.getByText('Waiting for sign-in in your browser…')).toBeVisible()
    await w.getByRole('button', { name: 'Open browser' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Opened your browser' })).toBeVisible()

    // Closing the wizard stops `vega devmode login`; the world never gets signed in.
    await w.getByRole('button', { name: 'Cancel' }).click()
    await expect(wizard(page)).toHaveCount(0)
    expect(sandbox.world().account).toBe('signed-out')
  })

  test('a wrong code is rejected and a fresh one works', async ({ sandbox, launch }) => {
    sandbox.update((w) => {
      w.account = 'signed-in'
      w.tvCode = 'XYZ789'
    })
    sandbox.installSdk()
    const { page } = await launch()
    await open(page)
    const w = wizard(page)
    await w.getByRole('button', { name: 'I see the code' }).click()
    await w.getByRole('button', { name: 'Continue' }).click()

    await w.getByRole('textbox', { name: 'Code from the TV' }).fill('ABC123')
    await w.getByRole('button', { name: 'Enable Developer Mode' }).click()

    await expect(w.getByText('Code is wrong or expired')).toBeVisible()
    await w.getByRole('button', { name: 'Enter a new code' }).click()
    await expect(w.getByRole('textbox', { name: 'Code from the TV' })).toHaveValue('')
    await w.getByRole('textbox', { name: 'Code from the TV' }).fill('XYZ789')
    await w.getByRole('button', { name: 'Enable Developer Mode' }).click()

    await expect(w.getByText('The device is rebooting')).toBeVisible()
    expect(sandbox.world().stick?.developerMode).toBe(true)
  })

  test('an expired sign-in asks to sign in again, then continues', async ({ sandbox, launch }) => {
    sandbox.update((w) => (w.account = 'expired'))
    sandbox.installSdk()
    const { page } = await launch()
    await open(page)
    const w = wizard(page)
    await w.getByRole('button', { name: 'I see the code' }).click()
    await w.getByRole('button', { name: 'Continue' }).click()
    await w.getByRole('textbox', { name: 'Code from the TV' }).fill('ABC123')
    await w.getByRole('button', { name: 'Enable Developer Mode' }).click()

    await expect(w.getByText('Not signed in')).toBeVisible()
    expect(sandbox.world().stick?.developerMode).toBe(false)

    // The user signs in again in the browser.
    sandbox.update((world) => (world.account = 'signed-in'))
    await w.getByRole('button', { name: 'Sign in again' }).click()
    await expect(w.getByText('Signed in to Amazon Developer Services')).toBeVisible()
  })

  test('the Wi‑Fi route hands over to the pairing wizard', async ({ sandbox, launch }) => {
    sandbox.update((w) => (w.account = 'signed-in'))
    sandbox.installSdk()
    const { page } = await launch()
    await open(page)
    const w = wizard(page)
    await w.getByRole('button', { name: 'I see the code' }).click()
    await w.getByRole('button', { name: 'Continue' }).click()
    await w.getByRole('textbox', { name: 'Code from the TV' }).fill('ABC123')
    await w.getByRole('button', { name: 'Enable Developer Mode' }).click()
    await w.getByRole('button', { name: 'Continue' }).click()

    await w.getByRole('radio', { name: /Wi-Fi/ }).click()

    await expect(wizard(page)).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Pair a device over Wi-Fi' })).toBeVisible()
  })
})
