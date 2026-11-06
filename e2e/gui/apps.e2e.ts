import type { Page } from '@playwright/test'
import { ALL_PACKAGES } from '../fake-sdk/world.ts'
import { expect, test } from '../harness/gui.ts'

const SHELL = 'vega exec vda -s emulator-5554 shell'
const ALL = `${SHELL} ${ALL_PACKAGES}`
const VLCM = `${SHELL} vlcm list`
const TITLE = 'Basic UI React Native Application for project player'

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

test.describe('Apps', () => {
  test('Running now lists the player; All apps shows it with its components, then it stops', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    // The player installed on the Virtual Device and running (launches come in 2.4b).
    sandbox.update((w) => {
      w.vvd.running = true
      w.installed.push({ device: 'VirtualDevice', package: 'player-aarch64-debug' })
      w.running.push({ device: 'VirtualDevice', app: 'com.example.player' })
    })
    const { page } = await launch()

    const runningNow = page.getByRole('region', { name: 'Running now' })
    await expect(runningNow.getByText(TITLE)).toBeVisible()
    await expect(runningNow.getByText(/^pid \d+ · VISIBLE$/)).toBeVisible()

    await runningNow.getByRole('button', { name: 'All apps →' }).click()

    await expect(page.getByRole('heading', { name: 'Apps', level: 1 })).toBeVisible()
    await expect(
      page.getByText(
        'On Vega Virtual Device · launches are verified against running-apps and crash history'
      )
    ).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Installed · 1' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Running · 1' })).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: TITLE })
    await expect(row).toContainText('com.example.player')
    await expect(row).toContainText(/Running · \d+/)
    await expect(echo(page)).toContainText('$ ovd apps --device VirtualDevice')

    const detail = page.getByRole('complementary', { name: `${TITLE} details` })
    await expect(detail.getByText('Components · vpm info / vlcm list')).toBeVisible()
    await expect(detail.getByText('interactive')).toBeVisible()
    await expect(detail.getByText('PERMANENT')).toBeVisible()

    await row.click()
    await expect(echo(page)).toContainText(
      '$ ovd apps info com.example.player --device VirtualDevice'
    )
    expect(sandbox.calls()).toEqual(
      expect.arrayContaining([ALL, VLCM, `${SHELL} vpm info com.example.player.main`])
    )

    // The app stops outside OVD; the screen reads again when the window regains focus.
    sandbox.update((w) => {
      w.running = []
    })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(row).toContainText('Stopped')
    await expect(page.getByRole('tab', { name: 'Running · 0' })).toBeVisible()
    await page.getByRole('tab', { name: 'Running · 0' }).click()
    await expect(page.getByText('Nothing running on this device.')).toBeVisible()
    // Reading apps changes nothing on the device, so nothing is logged.
    expect(sandbox.activity()).toEqual([])
  })

  test('nothing installed points to Packages', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    sandbox.update((w) => {
      w.vvd.running = true
    })
    const { page } = await launch()

    await expect(
      page.getByRole('region', { name: 'Running now' }).getByText('No apps running')
    ).toBeVisible()
    await nav(page, 'Apps').click()

    await expect(page.getByText('No apps you installed on Vega Virtual Device')).toBeVisible()
    await page.getByRole('button', { name: 'Go to Packages' }).click()
    await expect(page.getByRole('heading', { name: 'Packages', level: 1 })).toBeVisible()
  })

  test('with no device online there is no target to read', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()

    await expect(
      page.getByRole('region', { name: 'Running now' }).getByText('Virtual Device is stopped')
    ).toBeVisible()
    await nav(page, 'Apps').click()

    await expect(page.getByText('No target device')).toBeVisible()
    expect(sandbox.calls().filter((c) => c.startsWith(SHELL))).toEqual([])
  })
})
