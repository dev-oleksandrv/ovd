import type { Page } from '@playwright/test'
import { VVD_VDA_SERIAL } from '../fake-sdk/world.ts'
import { expect, test } from '../harness/gui.ts'
import type { Sandbox } from '../harness/sandbox.ts'

function deviceRow(page: Page, name: RegExp) {
  return page.getByRole('list', { name: 'Devices' }).getByRole('button', { name })
}

function toast(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text })
}

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

const REBOOT = `vega exec vda -s ${VVD_VDA_SERIAL} reboot`
const LIST = 'vega exec vda devices -l'
// Longer than any test: the device comes back when the test says so.
const AWAY_MS = 10 * 60_000

// The reboot's wait has listed the device away, so bringing it back now ends the wait (back
// before the wait saw it away, the device would count as never restarted). The wait lists 1 s
// after `vda reboot` answers; the desktop's device poll runs one at a time, 2 s after the last
// one ended (devicesWatcher.ts), and the calls queue in order on the serial runner: so of the
// listings after the reboot, the second is the wait's at the latest. A third leaves room for one
// more from the desktop. Every listing while the device is away answers it away.
async function sawAway(sandbox: Sandbox): Promise<void> {
  await expect
    .poll(() => {
      const calls = sandbox.calls()
      const sent = calls.indexOf(REBOOT)
      return sent === -1 ? 0 : calls.slice(sent + 1).filter((c) => c === LIST).length
    })
    .toBeGreaterThanOrEqual(3)
}

test.describe('Reboot & wait', () => {
  test.describe('a running Virtual Device', () => {
    // Away until the test brings it back, not for a fixed `rebootMs`: how long the desktop takes
    // to get through each step depends on the host's load.
    test.use({ world: { vvd: { running: true, developerMode: true }, rebootMs: AWAY_MS } })

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
      await sawAway(sandbox)
      // Still away: the desktop still shows the wait.
      await expect(deviceRow(page, /Vega Virtual Device.*Rebooting…/)).toBeVisible()

      // Back: listed online again, info answering.
      sandbox.update((w) => {
        w.vvd.rebootingUntil = 0
      })

      await expect(toast(page, 'Vega Virtual Device is back online')).toContainText(
        '$ ovd reboot --device VirtualDevice'
      )
      await expect(deviceRow(page, /Vega Virtual Device.*Online/)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Reboot & wait', exact: true })).toBeVisible()
      expect(sandbox.calls()).toContain(REBOOT)
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
