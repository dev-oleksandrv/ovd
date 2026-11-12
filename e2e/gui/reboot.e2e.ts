import type { Page } from '@playwright/test'
import { VVD_VDA_SERIAL } from '../fake-sdk/world.ts'
import { expect, test } from '../harness/gui.ts'

function deviceRow(page: Page, name: RegExp) {
  return page.getByRole('list', { name: 'Devices' }).getByRole('button', { name })
}

function toast(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text })
}

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

test.describe('Reboot & wait', () => {
  test.describe('a running Virtual Device', () => {
    test.use({ world: { vvd: { running: true, developerMode: true } } })

    test('shows Rebooting… while it is away, then Online, a toast and the echo', async ({
      sandbox,
      launch
    }) => {
      sandbox.installSdk()
      const { page } = await launch()
      await deviceRow(page, /Vega Virtual Device.*Online/).click()
      // The doctor run at launch reads the Virtual Device too; its sign-in probe is its last
      // SDK call, so the reboot starts after it.
      await expect.poll(() => sandbox.calls()).toContain('vega devmode login --json')

      await page.getByRole('button', { name: 'Reboot & wait', exact: true }).click()

      await expect(page.getByRole('button', { name: 'Rebooting…', exact: true })).toBeVisible()
      await expect(deviceRow(page, /Vega Virtual Device.*Rebooting…/)).toBeVisible()
      await expect(
        page.getByText('Rebooting Vega Virtual Device… OVD waits until it’s back online.')
      ).toBeVisible()
      await expect(echo(page)).toContainText('$ ovd reboot --device VirtualDevice')

      await expect(toast(page, 'Vega Virtual Device is back online')).toContainText(
        '$ ovd reboot --device VirtualDevice'
      )
      await expect(deviceRow(page, /Vega Virtual Device.*Online/)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reboot & wait', exact: true })).toBeVisible()
      expect(sandbox.calls()).toContain(`vega exec vda -s ${VVD_VDA_SERIAL} reboot`)
      expect(sandbox.activity().filter((a) => a.action === 'reboot')).toEqual([
        expect.objectContaining({ surface: 'desktop', target: 'VirtualDevice', result: 'ok' })
      ])
    })
  })

  test('is not offered for a stopped Virtual Device', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await deviceRow(page, /Vega Virtual Device.*Stopped/).click()
    await expect(page.getByText('The Virtual Device is stopped.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reboot & wait', exact: true })).toHaveCount(0)
  })
})
