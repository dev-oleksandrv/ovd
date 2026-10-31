import type { Page } from '@playwright/test'
import { STICK_ADDRESS, STICK_IP, STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { expect, test } from '../harness/gui.ts'
import { ovd } from '../harness/cli.ts'

function wizard(page: Page) {
  return page.getByRole('dialog', { name: 'Pair a device over Wi-Fi' })
}

function deviceRow(page: Page, name: RegExp) {
  return page.getByRole('list', { name: 'Devices' }).getByRole('button', { name })
}

function toast(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text })
}

test.describe('Pair over Wi‑Fi with USB', () => {
  test.use({ world: { stick: usbStick() } })

  test('switches the stick to TCP/IP and lists it over Wi‑Fi', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await expect(deviceRow(page, /Fire TV stick.*USB/)).toBeVisible()

    await page.getByRole('button', { name: 'Pair over Wi‑Fi' }).click()
    const w = wizard(page)
    await expect(w.getByRole('radio', { name: /With USB/ })).toHaveAttribute('aria-checked', 'true')
    await w.getByRole('button', { name: 'Next' }).click()
    await expect(w.getByText('vega exec vda tcpip 5555')).toBeVisible()
    await w.getByRole('button', { name: 'Run & continue' }).click()

    await expect(w).toContainText('Step 4 of 4')
    await expect(w.getByText(`vega exec vda connect ${STICK_ADDRESS} → connected`)).toBeVisible()
    await expect(w.getByText(`Serial ${STICK_SERIAL}`)).toBeVisible()
    expect(sandbox.calls()).toEqual(
      expect.arrayContaining([
        `vega exec vda -s ${STICK_SERIAL} tcpip 5555`,
        `vega exec vda connect ${STICK_ADDRESS}`
      ])
    )
    await w.getByRole('button', { name: 'Done' }).click()

    await expect(toast(page, 'Device paired over Wi-Fi')).toContainText('$ ovd pair --usb')
    await expect(deviceRow(page, /Fire TV stick.*Wi-Fi.*Online/)).toBeVisible()
    await expect(deviceRow(page, /Fire TV stick.*USB/)).toHaveCount(0)
  })

  test('forgetting it switches it back to USB', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    // Paired from the CLI: both surfaces share the saved devices.
    expect((await ovd(sandbox, ['pair', '--usb'])).exitCode).toBe(0)
    const { page } = await launch()
    await deviceRow(page, /Wi-Fi/).click()

    await page.getByRole('button', { name: 'Forget' }).click()
    await expect(
      page.getByText('Forget Fire TV stick? It switches back to USB; pair it again to use Wi‑Fi.')
    ).toBeVisible()
    await page.getByRole('button', { name: 'Forget' }).last().click()

    await expect(toast(page, 'Forgot Fire TV stick · switching back to USB')).toContainText(
      `$ ovd forget ${STICK_ADDRESS}`
    )
    await expect(deviceRow(page, /Fire TV stick.*USB.*Online/)).toBeVisible()
    await expect(deviceRow(page, /Wi-Fi/)).toHaveCount(0)
    expect(sandbox.hostState()).toMatchObject({ saved: [] })
  })
})

test.describe('Pair over Wi‑Fi without USB', () => {
  // TCP/IP turned on in the TV's Developer Options.
  test.use({ world: { stick: usbStick({ mode: 'tcpip', usbCable: false }) } })

  async function toAddress(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'Pair over Wi‑Fi' }).click()
    const w = wizard(page)
    await w.getByRole('radio', { name: /Without USB/ }).click()
    await w.getByRole('button', { name: 'Next' }).click()
    await w.getByRole('button', { name: 'The TV has rebooted' }).click()
    await expect(w).toContainText('Step 3 of 4')
  }

  test('checks the port, reports a refused one, and pairs on the right one', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await toAddress(page)
    const w = wizard(page)
    await w.getByRole('textbox', { name: 'IP address' }).fill(STICK_IP)

    await w.getByRole('textbox', { name: 'Port' }).fill('80')
    await expect(w.getByText('Port must be a number above 1024.')).toBeVisible()
    await expect(w.getByRole('button', { name: 'Connect' })).toBeDisabled()

    await w.getByRole('textbox', { name: 'Port' }).fill('5556')
    await expect(w.getByText(`vega exec vda connect ${STICK_IP}:5556`)).toBeVisible()
    await w.getByRole('button', { name: 'Connect' }).click()
    await expect(w.getByText('Connection refused')).toBeVisible()
    expect(sandbox.hostState()).toBeNull()

    await w.getByRole('textbox', { name: 'Port' }).fill('5555')
    await w.getByRole('button', { name: 'Retry' }).click()
    await expect(w).toContainText('Step 4 of 4')
    await w.getByRole('button', { name: 'Done' }).click()

    await expect(toast(page, 'Device paired over Wi-Fi')).toContainText(
      `$ ovd pair ${STICK_ADDRESS}`
    )
    await expect(deviceRow(page, /Fire TV stick.*Wi-Fi.*Online/)).toBeVisible()
    expect(sandbox.hostState()).toMatchObject({ saved: [{ id: STICK_ADDRESS }] })
  })

  test('an address on another network says so', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await toAddress(page)
    const w = wizard(page)

    await w.getByRole('textbox', { name: 'IP address' }).fill('192.0.2.1')
    await w.getByRole('button', { name: 'Connect' }).click()

    await expect(w.getByText('Device and computer are on different networks')).toBeVisible()
  })
})

test.describe('saved Wi‑Fi devices', () => {
  test.use({ world: { stick: usbStick({ mode: 'tcpip', usbCable: false }) } })

  test('reconnect at launch after a host restart, without retyping the address', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    expect((await ovd(sandbox, ['pair', STICK_ADDRESS])).exitCode).toBe(0)
    // The host restarts: VDA forgets its connections.
    sandbox.update((w) => (w.vdaConnected = []))

    const { page } = await launch()

    await expect(deviceRow(page, /Fire TV stick.*Wi-Fi.*Online/)).toBeVisible()
    expect(sandbox.calls()).toContain(`vega exec vda connect ${STICK_ADDRESS}`)
  })

  test('a lost connection shows offline with Reconnect, which brings it back', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    expect((await ovd(sandbox, ['pair', STICK_ADDRESS])).exitCode).toBe(0)
    const { page } = await launch()
    await expect(deviceRow(page, /Fire TV stick.*Online/)).toBeVisible()

    // VDA's server restarts while the app runs; polls don't reconnect on their own.
    sandbox.update((w) => (w.vdaConnected = []))
    await expect(deviceRow(page, /Fire TV stick.*Offline/)).toBeVisible()
    await deviceRow(page, /Fire TV stick/).click()
    await expect(page.getByText('Device info unavailable')).toBeVisible()

    await page.getByRole('button', { name: 'Reconnect' }).click()

    await expect(toast(page, 'Fire TV stick is back online')).toContainText(
      `$ ovd connect ${STICK_ADDRESS}`
    )
    await expect(deviceRow(page, /Fire TV stick.*Online/)).toBeVisible()
  })

  test('a powered-off stick is listed offline, dimmed, until it is back', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    expect((await ovd(sandbox, ['pair', STICK_ADDRESS])).exitCode).toBe(0)
    const { page } = await launch()
    await expect(deviceRow(page, /Fire TV stick.*Online/)).toBeVisible()

    sandbox.update((w) => {
      if (w.stick) w.stick.powered = false
    })
    await expect(deviceRow(page, /Fire TV stick.*Offline/)).toHaveClass(/opacity-60/)

    // VDA keeps the connection and picks the stick up again by itself.
    sandbox.update((w) => {
      if (w.stick) w.stick.powered = true
    })
    await expect(deviceRow(page, /Fire TV stick.*Online/)).toBeVisible()
  })
})
