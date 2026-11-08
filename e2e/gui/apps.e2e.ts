import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { decodeScript } from '../fake-sdk/scripts.ts'
import { ALL_PACKAGES } from '../fake-sdk/world.ts'
import { expect, test } from '../harness/gui.ts'
import { MANIFEST, makeProject, makeRecordedVpkg } from '../harness/project.ts'

const SHELL = 'vega exec vda -s emulator-5554 shell'
const ALL = `${SHELL} ${ALL_PACKAGES}`
const VLCM = `${SHELL} vlcm list`
const TITLE = 'Basic UI React Native Application for project player'
const TERMINATE = `${SHELL} vlcm terminate-app --pkg-id com.example.player`
const LAUNCH = 'vega device launch-app -a com.example.player.main --device VirtualDevice'
const PKG_INFO = `${SHELL} vpm info com.example.player --package`
const UNINSTALL = 'vega device uninstall-app -a com.example.player --device VirtualDevice'
const AARCH64 = 'dev/player/build/aarch64-debug/player_aarch64.vpkg'
// The player's own manifest: the project the recorded player packages were built from.
const PLAYER_MANIFEST = MANIFEST.replaceAll('hellovega', 'player')

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

function toast(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text })
}

// A launch is verified for about 5 s (ADR 0012) while the 2 s device polls share the serial
// runner, so wait for "Verifying…" to show and then to go before the toast: no single wait has
// to cover the whole verification.
async function verified(row: Locator): Promise<void> {
  await expect(row).toContainText('Verifying…')
  await expect(row).not.toContainText('Verifying…')
}

// The device script a `… shell echo <base64> | base64 -d | sh` call ran, or null.
function scriptOf(call: string): string | null {
  return call.startsWith(`${SHELL} `) ? decodeScript(`shell ${call.slice(SHELL.length + 1)}`) : null
}

// The native picker can't be driven, so the next one answers with `path`.
async function nextPick(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, path)
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

  test('Force stop on the running player stops it, and Apps and Running now follow', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    sandbox.update((w) => {
      w.vvd.running = true
      w.installed.push({ device: 'VirtualDevice', package: 'player-aarch64-debug' })
      w.running.push({ device: 'VirtualDevice', app: 'com.example.player' })
    })
    const { page } = await launch()
    await nav(page, 'Apps').click()
    const row = page.getByRole('row').filter({ hasText: TITLE })
    await expect(row).toContainText(/Running · \d+/)

    await row.click()
    const detail = page.getByRole('complementary', { name: `${TITLE} details` })
    await detail.getByRole('button', { name: 'Force stop' }).click()

    const cli = '$ ovd apps terminate com.example.player --force --device VirtualDevice'
    await expect(toast(page, `Force stopped ${TITLE}`)).toContainText(cli)
    await expect(echo(page)).toContainText(cli)
    await expect(row).toContainText('Stopped')
    await expect(page.getByRole('tab', { name: 'Running · 0' })).toBeVisible()
    expect(sandbox.calls()).toContain(
      `${SHELL} vlcm terminate-app --force --pkg-id com.example.player`
    )
    expect(sandbox.world().running).toEqual([])

    await nav(page, 'Devices').click()
    await expect(
      page.getByRole('region', { name: 'Running now' }).getByText('No apps running')
    ).toBeVisible()

    const activity = sandbox.activity().filter((a) => a.surface === 'desktop')
    expect(activity.map((a) => [a.action, a.result])).toEqual([['app.terminate', 'ok']])
    expect(activity[0]).toMatchObject({ args: { app: 'com.example.player', force: 'true' } })
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
    await verified(row)
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
    await verified(row)
    await expect(row).toContainText(/Running · \d+/)
    const detail = page.getByRole('complementary', { name: `${TITLE} details` })
    await detail.getByRole('button', { name: 'Restart' }).click()
    await verified(row)
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

  test('install the player from Packages, then uninstall & reinstall it from its detail', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    sandbox.update((w) => {
      w.vvd.running = true
    })
    makeProject(sandbox.home, 'player', { manifest: PLAYER_MANIFEST })
    const aarch64 = makeRecordedVpkg(
      sandbox.home,
      AARCH64,
      'player-aarch64-debug',
      new Date('2026-10-13T09:00:00Z')
    )
    const install = `vega device install-app -p ${aarch64} --device VirtualDevice`
    const { app, page } = await launch()
    await nextPick(app, `${sandbox.home}/dev/player`)
    await page
      .getByRole('region', { name: 'Project' })
      .getByRole('button', { name: 'Open a project folder…' })
      .click()
    await expect(toast(page, 'Opened player')).toBeVisible()

    await nav(page, 'Packages').click()
    await expect(page.getByText(`~/${AARCH64}`)).toBeVisible()
    await page.getByRole('button', { name: 'Install on target' }).click()
    const installCli = `$ ovd apps install ~/${AARCH64} --device VirtualDevice`
    await expect(toast(page, 'Installed on Vega Virtual Device')).toContainText(installCli)
    await expect(echo(page)).toContainText(installCli)
    expect(sandbox.world().installed).toEqual([
      { device: 'VirtualDevice', package: 'player-aarch64-debug' }
    ])

    await nav(page, 'Apps').click()
    const row = page.getByRole('row').filter({ hasText: TITLE })
    await expect(row).toContainText('com.example.player')
    await expect(row).toContainText('Stopped')
    await row.click()
    const detail = page.getByRole('complementary', { name: `${TITLE} details` })
    const before = sandbox.calls().length

    await detail.getByRole('button', { name: 'Uninstall & reinstall' }).click()

    await expect(toast(page, `Reinstalled ${TITLE}`)).toBeVisible()
    await expect(echo(page)).toContainText(
      '$ ovd apps reinstall com.example.player --device VirtualDevice'
    )
    const calls = sandbox
      .calls()
      .slice(before)
      .filter((c) => c === PKG_INFO || c === UNINSTALL || c === install)
    expect(calls).toEqual([PKG_INFO, UNINSTALL, install])
    await expect(row).toContainText('Stopped')
    expect(sandbox.world().installed).toEqual([
      { device: 'VirtualDevice', package: 'player-aarch64-debug' }
    ])
    expect(
      sandbox
        .activity()
        .filter((a) => a.surface === 'desktop')
        .map((a) => [a.action, a.result])
    ).toEqual([
      ['app.install', 'ok'],
      ['app.reinstall', 'ok']
    ])
  })

  test('Launch on the crashing player shows Verifying…, then Crashed on launch with its cause and logs', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    sandbox.update((w) => {
      w.vvd.running = true
      w.installed.push({ device: 'VirtualDevice', package: 'player-aarch64-debug' })
      w.playerCrashesOnLaunch = true
    })
    const { page } = await launch()
    await nav(page, 'Apps').click()
    const row = page.getByRole('row').filter({ hasText: TITLE })
    const detail = page.getByRole('complementary', { name: `${TITLE} details` })
    await expect(row).toContainText('Stopped')

    await row.getByRole('button', { name: 'Launch' }).click()

    await expect(row).toContainText('Verifying…')
    await expect(detail.getByText('Verifying launch…')).toBeVisible()
    await expect(row).toContainText('Crashed on launch')
    await expect(detail.getByText('Crashed on launch')).toBeVisible()
    const cli = '$ ovd apps launch com.example.player --device VirtualDevice'
    await expect(toast(page, 'Launch reported success, but the app crashed')).toContainText(cli)
    await expect(echo(page)).toContainText(cli)
    const callout = detail.getByRole('alert')
    await expect(callout).toContainText('Launch reported success, but the app crashed')
    await expect(callout).toContainText('SIGABRT')
    await expect(callout).toContainText('pid 3200')
    await callout.getByRole('button', { name: 'Logs around crash' }).click()
    await expect(callout).toContainText('crashed with signal 6')

    await nav(page, 'Devices').click()
    await nav(page, 'Apps').click()
    await expect(row).toContainText('Crashed on launch')

    const activity = sandbox.activity().filter((a) => a.surface === 'desktop')
    expect(activity.map((a) => [a.action, a.result])).toEqual([['app.launch', 'error']])
    expect(activity[0]).toMatchObject({
      errorCode: 'LAUNCH_NOT_VERIFIED',
      args: { app: 'com.example.player', reason: 'crashed', pid: '3200', signal: 'SIGABRT' }
    })
    const stop = sandbox
      .calls()
      .map(scriptOf)
      .find((script) => script?.startsWith('pkill -P 2056;'))
    expect(stop).toContain(String.raw`'\[3200\]'`)
    expect(sandbox.world().running).toEqual([])
  })
})
