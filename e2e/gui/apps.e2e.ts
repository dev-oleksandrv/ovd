import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { decodeScript } from '../fake-sdk/scripts.ts'
import { ALL_PACKAGES, STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { expect, test } from '../harness/gui.ts'
import { MANIFEST, makeProject, makeRecordedVpkg } from '../harness/project.ts'
import type { Sandbox } from '../harness/sandbox.ts'

const SHELL = 'vega exec vda -s emulator-5554 shell'
const STICK_SHELL = `vega exec vda -s ${STICK_SERIAL} shell`
const ALL = `${SHELL} ${ALL_PACKAGES}`
const VLCM = `${SHELL} vlcm list`
const TITLE = 'Basic UI React Native Application for project player'
const TERMINATE = `${SHELL} vlcm terminate-app --pkg-id com.example.player`
const LAUNCH = 'vega device launch-app -a com.example.player.main --device VirtualDevice'
const PKG_INFO = `${SHELL} vpm info com.example.player --package`
const UNINSTALL = 'vega device uninstall-app -a com.example.player --device VirtualDevice'
const AARCH64 = 'dev/player/build/aarch64-debug/player_aarch64.vpkg'
const UNINSTALL_ASK = `Uninstall ${TITLE} from Vega Virtual Device?`
const REINSTALL_ASK = `Uninstall & reinstall ${TITLE} on Vega Virtual Device?`
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

// The verification (launchVerification.ts) sleeps about 7 s: 5 × 1 s settle polls, then a 1 s
// recheck or up to 1 s of tombstone retries. It also makes about 14 SDK calls of its own, and
// the 2 s device polls (2 calls each) queue between them on the serial runner. Click to result
// measured 12–15 s on a loaded host, so 30 s is twice the measured worst case. Only the waits
// that cover the verification use it.
const VERIFY_MS = 30_000

// A launch is verified (ADR 0012) before the toast shows. The renderer shows "Verifying…" at the
// click, so the first wait passes at once; the second covers the whole verification.
async function verified(row: Locator): Promise<void> {
  await expect(row).toContainText('Verifying…')
  await expect(row).not.toContainText('Verifying…', { timeout: VERIFY_MS })
}

// The doctor run at app start shares the serial runner with the launch verification, so its
// calls would queue in front of it. With the Vega CLI and Developer Mode on, as in these worlds,
// and no project open, its sign-in probe is its last SDK call (as in reboot.e2e.ts). A call is
// logged when it starts, so the probe may still be finishing; that is one call, not the run.
async function doctorDone(sandbox: Sandbox): Promise<void> {
  await expect.poll(() => sandbox.calls()).toContain('vega devmode login --json')
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

  test.describe('on the stick', () => {
    test.use({ world: { stick: usbStick() } })

    test('an unplugged target: Apps unavailable, and nothing is read from it', async ({
      sandbox,
      launch
    }) => {
      sandbox.installSdk()
      // Remembered as the target, so it stays the target once it is gone.
      expect((await ovd(sandbox, ['target', 'set', STICK_SERIAL])).exitCode).toBe(0)
      const { page } = await launch()
      const target = page.getByRole('button', { name: 'Target: Fire TV stick' })
      await expect(target).toBeVisible()
      sandbox.update((w) => {
        if (w.stick) w.stick.usbCable = false
      })
      await expect(target).toContainText('Offline')
      // Running now on Devices may have read the stick while it was plugged in.
      sandbox.clearCalls()

      await nav(page, 'Apps').click()

      await expect(page.getByText('Apps unavailable — Fire TV stick is offline')).toBeVisible()
      await page.getByRole('button', { name: 'Switch target' }).click()
      await expect(page.getByRole('menu', { name: 'Target device' })).toBeVisible()
      expect(sandbox.calls().filter((c) => c.startsWith(STICK_SHELL))).toEqual([])
    })
  })

  test.describe('while the device reads its packages', () => {
    // On the Virtual Device: the stick's recording lists a store app whose component read
    // isn't recorded on the stick.
    test.use({ world: { vvd: { running: true, developerMode: true }, hold: [ALL] } })

    test('shows Reading apps…, then the empty list once the read answers', async ({
      sandbox,
      launch
    }) => {
      sandbox.installSdk()
      const { page } = await launch()
      await expect(page.getByRole('button', { name: 'Target: Vega Virtual Device' })).toBeVisible()
      await nav(page, 'Apps').click()

      const reading = page
        .getByRole('status')
        .filter({ hasText: 'Reading apps on Vega Virtual Device…' })
      await expect(reading).toBeVisible()
      await expect(page.getByText('No apps you installed on Vega Virtual Device')).toHaveCount(0)

      sandbox.update((w) => {
        w.hold = []
      })

      await expect(page.getByText('No apps you installed on Vega Virtual Device')).toBeVisible()
      await expect(reading).toHaveCount(0)
      expect(sandbox.calls()).toContain(ALL)
    })
  })

  test('launch, stop, restart and uninstall the player, with Apps and Running now following', async ({
    sandbox,
    launch
  }) => {
    // Three verified launches (launch, relaunch, restart), each up to VERIFY_MS (30 s) on a
    // loaded host, plus the navigation, the stop and the uninstall. It took 49–54 s of the 60 s
    // test timeout even on a light host and hit it in CI run 42803119952; slow() gives 3 × 60 s.
    test.slow()
    sandbox.installSdk()
    sandbox.update((w) => {
      w.vvd.running = true
      w.installed.push({ device: 'VirtualDevice', package: 'player-aarch64-debug' })
    })
    const { page } = await launch()
    await nav(page, 'Apps').click()
    const row = page.getByRole('row').filter({ hasText: TITLE })
    await expect(row).toContainText('Stopped')
    await doctorDone(sandbox)

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

    // Uninstall asks first, with Cancel focused; cancelling runs nothing.
    await detail.getByRole('button', { name: 'Uninstall', exact: true }).click()
    const ask = page.getByRole('dialog', { name: UNINSTALL_ASK })
    await expect(ask).toBeVisible()
    await expect(ask.getByText('Its app data is removed.')).toBeVisible()
    await expect(ask.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await ask.getByRole('button', { name: 'Cancel' }).click()
    await expect(ask).toBeHidden()
    await expect(row).toContainText('com.example.player')
    await expect(echo(page)).toContainText(
      '$ ovd apps restart com.example.player --device VirtualDevice'
    )
    expect(sandbox.calls()).not.toContain(UNINSTALL)
    expect(sandbox.activity().filter((a) => a.action === 'app.uninstall')).toEqual([])

    await detail.getByRole('button', { name: 'Uninstall', exact: true }).click()
    await expect(ask).toBeVisible()
    await ask.getByRole('button', { name: 'Uninstall', exact: true }).click()
    await expect(ask).toBeHidden()
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
    expect(sandbox.calls().filter((c) => c === UNINSTALL)).toHaveLength(1)
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
    const ask = page.getByRole('dialog', { name: REINSTALL_ASK })
    await expect(ask).toBeVisible()
    await expect(
      ask.getByText('Its app data is removed, then the build is installed again.')
    ).toBeVisible()
    await ask.getByRole('button', { name: 'Uninstall & reinstall' }).click()
    await expect(ask).toBeHidden()

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
    await doctorDone(sandbox)

    await row.getByRole('button', { name: 'Launch' }).click()

    await expect(row).toContainText('Verifying…')
    await expect(detail.getByText('Verifying launch…')).toBeVisible()
    await expect(row).toContainText('Crashed on launch', { timeout: VERIFY_MS })
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

  test('Launch on the player that isn’t running afterwards shows the not-running callout', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    sandbox.update((w) => {
      w.vvd.running = true
      w.installed.push({ device: 'VirtualDevice', package: 'player-aarch64-debug' })
      w.playerStopsOnLaunch = true
    })
    const { page } = await launch()
    await nav(page, 'Apps').click()
    const row = page.getByRole('row').filter({ hasText: TITLE })
    const detail = page.getByRole('complementary', { name: `${TITLE} details` })
    await expect(row).toContainText('Stopped')
    await doctorDone(sandbox)

    await row.getByRole('button', { name: 'Launch' }).click()
    await verified(row)

    const message = 'Launch reported success, but the app isn’t running'
    const cli = '$ ovd apps launch com.example.player --device VirtualDevice'
    await expect(toast(page, message)).toContainText(cli)
    await expect(echo(page)).toContainText(cli)
    await expect(detail.getByRole('alert')).toContainText(message)
    await expect(row).toContainText('Stopped')

    const activity = sandbox.activity().filter((a) => a.surface === 'desktop')
    expect(activity.map((a) => [a.action, a.result])).toEqual([['app.launch', 'error']])
    expect(activity[0]).toMatchObject({
      errorCode: 'LAUNCH_NOT_VERIFIED',
      args: { app: 'com.example.player', reason: 'not-running' }
    })
    expect(sandbox.calls()).toContain(LAUNCH)
    expect(sandbox.world().running).toEqual([])
  })

  test('Launch on a player started outside OVD says it is already running', async ({
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

    // Started outside OVD after the list was read: Apps doesn't poll, so the row still offers
    // Launch.
    sandbox.update((w) => {
      w.running.push({ device: 'VirtualDevice', app: 'com.example.player' })
    })
    await row.getByRole('button', { name: 'Launch' }).click()

    const cli = '$ ovd apps launch com.example.player --device VirtualDevice'
    await expect(toast(page, `${TITLE} is already running`)).toContainText(cli)
    await expect(echo(page)).toContainText(cli)
    await expect(row).toContainText(/Running · \d+/)
    expect(sandbox.calls()).not.toContain(LAUNCH)
    expect(
      sandbox
        .activity()
        .filter((a) => a.surface === 'desktop')
        .map((a) => [a.action, a.result])
    ).toEqual([['app.launch', 'ok']])
  })
})
