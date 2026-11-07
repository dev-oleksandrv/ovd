import type { Page } from '@playwright/test'
import { ALL_PACKAGES } from '../fake-sdk/world.ts'
import { expect, test } from '../harness/gui.ts'

const SHELL = 'vega exec vda -s emulator-5554 shell'
const ALL = `${SHELL} ${ALL_PACKAGES}`
const VLCM = `${SHELL} vlcm list`
const TITLE = 'Basic UI React Native Application for project player'
const TERMINATE = `${SHELL} vlcm terminate-app --pkg-id com.example.player`
const LAUNCH = 'vega device launch-app -a com.example.player.main --device VirtualDevice'

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

function toast(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text })
}

test.describe('Apps', () => {
  test('Running now lists the player; All apps shows it with its components, then it stops', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    // The player installed on the Virtual Device and running, started outside OVD.
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

  test('launch, stop, restart and uninstall the player, with Apps and Running now following', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    sandbox.update((w) => {
      w.vvd.running = true
      w.installed.push({ device: 'VirtualDevice', package: 'player-aarch64-debug' })
    })
    const { page } = await launch()
    await nav(page, 'Apps').click()
    const row = page.getByRole('row').filter({ hasText: TITLE })
    await expect(row).toContainText('Stopped')

    await row.getByRole('button', { name: 'Launch' }).click()
    await expect(toast(page, `Launched ${TITLE}`)).toBeVisible()
    await expect(echo(page)).toContainText(
      '$ ovd apps launch com.example.player --device VirtualDevice'
    )
    await expect(row).toContainText(/Running · \d+/)
    await expect(page.getByRole('tab', { name: 'Running · 1' })).toBeVisible()

    await nav(page, 'Devices').click()
    await expect(page.getByRole('region', { name: 'Running now' }).getByText(TITLE)).toBeVisible()

    await nav(page, 'Apps').click()
    await row.getByRole('button', { name: 'Stop' }).click()
    await expect(toast(page, `Stopped ${TITLE}`)).toBeVisible()
    await expect(echo(page)).toContainText(
      '$ ovd apps terminate com.example.player --device VirtualDevice'
    )
    await expect(row).toContainText('Stopped')
    await expect(page.getByRole('tab', { name: 'Running · 0' })).toBeVisible()
    await nav(page, 'Devices').click()
    await expect(
      page.getByRole('region', { name: 'Running now' }).getByText('No apps running')
    ).toBeVisible()

    await nav(page, 'Apps').click()
    await row.getByRole('button', { name: 'Launch' }).click()
    await expect(row).toContainText(/Running · \d+/)
    const detail = page.getByRole('complementary', { name: `${TITLE} details` })
    await detail.getByRole('button', { name: 'Restart' }).click()
    await expect(toast(page, `Restarted ${TITLE}`)).toBeVisible()
    await expect(echo(page)).toContainText(
      '$ ovd apps restart com.example.player --device VirtualDevice'
    )
    const calls = sandbox.calls()
    expect(calls.lastIndexOf(TERMINATE)).toBeGreaterThan(-1)
    expect(calls.lastIndexOf(TERMINATE)).toBeLessThan(calls.lastIndexOf(LAUNCH))

    await detail.getByRole('button', { name: 'Uninstall', exact: true }).click()
    await expect(toast(page, `Uninstalled ${TITLE}`)).toBeVisible()
    await expect(echo(page)).toContainText(
      '$ ovd apps uninstall com.example.player --device VirtualDevice'
    )
    await expect(page.getByText('No apps you installed on Vega Virtual Device')).toBeVisible()

    expect(
      sandbox
        .activity()
        .filter((a) => a.surface === 'desktop')
        .map((a) => [a.action, a.result])
    ).toEqual([
      ['app.launch', 'ok'],
      ['app.terminate', 'ok'],
      ['app.launch', 'ok'],
      ['app.restart', 'ok'],
      ['app.uninstall', 'ok']
    ])
  })
})
