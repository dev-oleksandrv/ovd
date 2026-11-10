import type { Page } from '@playwright/test'
import { VVD_VDA_SERIAL } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { expect, test } from '../harness/gui.ts'
import { MANIFEST, makeProject, makeRecordedVpkg } from '../harness/project.ts'
import type { Sandbox } from '../harness/sandbox.ts'

const LOG = `vega exec vda -s ${VVD_VDA_SERIAL} shell loggingctl log -f -o short_concise`
const LAUNCH = 'vega device launch-app -a com.example.player.main --device VirtualDevice'
const AARCH64 = 'dev/player/build/aarch64-debug/player_aarch64.vpkg'
const ARMV7 = 'dev/player/build/armv7-release/player_armv7.vpkg'
const RUN_CLI = 'ovd run --device VirtualDevice'
// The player's own manifest: the project the recorded player packages were built from.
const PLAYER_MANIFEST = MANIFEST.replaceAll('hellovega', 'player')

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

function toast(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text })
}

function steps(page: Page) {
  return page.getByRole('region', { name: 'Run steps' })
}

// A player project with a Debug build for the Virtual Device and a newer Release build for
// sticks (what `react-native build-vega` writes, ARCHITECTURE §8), opened with the CLI: the
// desktop reads the same host state (ADR 0022).
async function openPlayerProject(sandbox: Sandbox): Promise<void> {
  makeProject(sandbox.home, 'player', { manifest: PLAYER_MANIFEST })
  makeRecordedVpkg(sandbox.home, AARCH64, 'player-aarch64-debug', new Date('2026-10-13T09:00:00Z'))
  makeRecordedVpkg(sandbox.home, ARMV7, 'player-armv7-release', new Date('2026-10-13T10:00:00Z'))
  expect((await ovd(sandbox, ['open', `${sandbox.home}/dev/player`])).exitCode).toBe(0)
}

const installOf = (sandbox: Sandbox, path: string) =>
  `vega device install-app -p ${sandbox.home}/${path} --device VirtualDevice`

test.use({ world: { vvd: { running: true, developerMode: true } } })

test.describe('Run', () => {
  test('Run ▸ player installs the debug build, follows the log, launches it and opens Logs', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    await openPlayerProject(sandbox)
    const { page } = await launch()

    const run = page.getByRole('button', { name: 'Run ▸ player' })
    await expect(run).toBeEnabled()
    await run.click()

    // The status bar echoes the run while it goes; once Logs opens, it echoes the session's.
    await expect(echo(page)).toContainText(`$ ${RUN_CLI}`)
    await expect(steps(page).getByText(RUN_CLI)).toBeVisible()
    await expect(
      steps(page).getByText('build/aarch64-debug/player_aarch64.vpkg · debug')
    ).toBeVisible()
    await expect(steps(page).getByRole('listitem', { name: 'Following logs: done' })).toBeVisible({
      timeout: 30_000
    })
    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Log lines' }).getByRole('listitem').first()
    ).toBeVisible()
    await expect(
      toast(page, 'Running player_aarch64.vpkg on Vega Virtual Device · verified')
    ).toContainText(`$ ${RUN_CLI}`)

    // The Debug build, the stream after the install and before the launch, one session.
    const calls = sandbox.calls()
    const install = calls.indexOf(installOf(sandbox, AARCH64))
    expect(install).toBeGreaterThanOrEqual(0)
    expect(calls).not.toContain(installOf(sandbox, ARMV7))
    expect(calls.indexOf(LOG)).toBeGreaterThan(install)
    expect(calls.indexOf(LAUNCH)).toBeGreaterThan(calls.indexOf(LOG))
    expect(calls.filter((c) => c === LOG)).toHaveLength(1)
    const actions = sandbox.activity().map((a) => [a.action, a.surface, a.result])
    expect(actions).toEqual(
      expect.arrayContaining([
        ['app.install', 'desktop', 'ok'],
        ['logs', 'desktop', 'ok'],
        ['app.restart', 'desktop', 'ok']
      ])
    )
  })

  test('with Logs already open, the run waits for its session to restart after the install', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    await openPlayerProject(sandbox)
    const { page } = await launch()
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Logs' })
      .click()
    await expect(
      page.getByRole('list', { name: 'Log lines' }).getByRole('listitem').first()
    ).toBeVisible()

    await page.getByRole('button', { name: 'Run ▸ player' }).click()

    await expect(steps(page).getByRole('listitem', { name: 'Following logs: done' })).toBeVisible({
      timeout: 30_000
    })
    // The open session restarted after the install (ADR 0014); no second session.
    const calls = sandbox.calls()
    const streams = calls.flatMap((c, i) => (c === LOG ? [i] : []))
    expect(streams).toHaveLength(2)
    expect(streams[1]).toBeGreaterThan(calls.indexOf(installOf(sandbox, AARCH64)))
    expect(calls.indexOf(LAUNCH)).toBeGreaterThan(streams[1] ?? Infinity)
    expect(
      sandbox
        .activity()
        .filter((a) => a.action === 'logs.restart')
        .map((a) => [a.args, a.result])
    ).toEqual([[{ reason: 'install' }, 'ok']])
  })

  test('disabled while the target is offline, with the reason; enabled once it is back', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    await openPlayerProject(sandbox)
    expect((await ovd(sandbox, ['target', 'set', 'VirtualDevice'])).exitCode).toBe(0)
    sandbox.update((w) => {
      w.vvd.running = false
    })
    const { page } = await launch()

    const run = page.getByRole('button', { name: 'Run ▸ player' })
    await expect(run).toBeDisabled()
    await expect(run).toHaveAttribute('title', 'Vega Virtual Device is offline')

    sandbox.update((w) => {
      w.vvd.running = true
    })
    await expect(run).toBeEnabled()
    expect(sandbox.calls().some((c) => c.includes('install-app'))).toBe(false)
  })

  test('a crash on launch: Verify launch fails with "Crashed on launch" and an error toast', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    sandbox.update((w) => {
      w.playerCrashesOnLaunch = true
    })
    await openPlayerProject(sandbox)
    const { page } = await launch()

    await page.getByRole('button', { name: 'Run ▸ player' }).click()

    await expect(steps(page).getByRole('listitem', { name: 'Verify launch: failed' })).toBeVisible({
      timeout: 30_000
    })
    await expect(steps(page).getByText(/^Crashed on launch/)).toBeVisible()
    const crashed = toast(page, 'Crashed on launch')
    await expect(crashed).toContainText(`$ ${RUN_CLI}`)
    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeHidden()
    await crashed.getByRole('button', { name: 'Open Logs' }).click()
    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible()
    expect(
      sandbox
        .activity()
        .filter((a) => a.action === 'app.restart')
        .map((a) => [a.result, a.errorCode])
    ).toEqual([['error', 'LAUNCH_NOT_VERIFIED']])
  })

  test('a .vpkg open instead of a folder: Run ▸ <file> installs that file', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const file = makeRecordedVpkg(
      sandbox.home,
      'Downloads/player_aarch64.vpkg',
      'player-aarch64-debug'
    )
    expect((await ovd(sandbox, ['open', file])).exitCode).toBe(0)
    const { page } = await launch()

    await page.getByRole('button', { name: 'Run ▸ player_aarch64.vpkg' }).click()
    await expect(echo(page)).toContainText(`$ ${RUN_CLI}`)

    await expect(steps(page).getByRole('listitem', { name: 'Following logs: done' })).toBeVisible({
      timeout: 30_000
    })
    expect(sandbox.calls()).toContain(installOf(sandbox, 'Downloads/player_aarch64.vpkg'))
    await expect(
      toast(page, 'Running player_aarch64.vpkg on Vega Virtual Device · verified')
    ).toContainText(`$ ${RUN_CLI}`)
  })
})

const WATCH_CLI = 'ovd run --watch --device VirtualDevice'
// The last line of fixtures/0.24/loggingctl-log/virtual-device-restart-after.txt: only a stream
// started after the redeploy's install prints it.
const AFTER_RESTART = '8378029e7a76c845'

function rows(page: Page) {
  return page.getByRole('list', { name: 'Log lines' }).getByRole('listitem')
}

test.describe('Watch', () => {
  test('a rebuild reinstalls and relaunches the app, with a toast and an OVD line, and the log goes on', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    await openPlayerProject(sandbox)
    const { page } = await launch()
    await page.getByRole('button', { name: 'Run ▸ player' }).click()
    await expect(steps(page).getByRole('listitem', { name: 'Following logs: done' })).toBeVisible({
      timeout: 30_000
    })

    const watch = page.getByRole('button', { name: 'Watch off' })
    await expect(watch).toBeEnabled()
    await watch.click()
    await expect(page.getByRole('button', { name: 'Watching build/' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(echo(page)).toContainText(`$ ${WATCH_CLI}`)
    await expect(toast(page, 'Watching build/ for new builds')).toContainText(`$ ${WATCH_CLI}`)

    // "Watching" is pushed once the watch has its baseline: the next write is a rebuild.
    makeRecordedVpkg(sandbox.home, AARCH64, 'player-aarch64-debug', new Date())

    await expect(
      toast(page, 'Redeployed player_aarch64.vpkg on Vega Virtual Device · verified')
    ).toContainText(`$ ${WATCH_CLI}`, { timeout: 30_000 })
    await expect(echo(page)).toContainText(`$ ${WATCH_CLI}`)

    // In Logs, the OVD line and, after it, a line only the restarted stream prints. A search
    // keeps that line and the OVD lines (they match every filter).
    await expect(page.getByRole('heading', { name: 'Logs', level: 1 })).toBeVisible()
    await page.getByRole('textbox', { name: 'Search logs' }).fill(AFTER_RESTART)
    const built = rows(page).filter({
      hasText: 'Build folder changed: build/aarch64-debug/player_aarch64.vpkg'
    })
    await expect(built).toBeVisible()
    await expect(rows(page).filter({ hasText: AFTER_RESTART })).toBeVisible()
    const texts = await rows(page).allTextContents()
    const at = (text: string) => texts.findIndex((t) => t.includes(text))
    expect(at(AFTER_RESTART)).toBeGreaterThan(at('Build folder changed'))

    // Two installs and two launches; Run's session followed both, restarted after the second
    // install (ADR 0014): one stream per install, never a second session.
    const calls = sandbox.calls()
    expect(calls.filter((c) => c === installOf(sandbox, AARCH64))).toHaveLength(2)
    expect(calls.filter((c) => c === LAUNCH)).toHaveLength(2)
    expect(calls.filter((c) => c === LOG)).toHaveLength(2)
    const pids = sandbox.logStreamPids()
    expect(pids).toHaveLength(2)
    expect(() => process.kill(pids[0] ?? -1, 0)).toThrow()
    expect(
      sandbox
        .activity()
        .filter((a) => a.action === 'build.changed')
        .map((a) => [a.surface, a.target, a.args])
    ).toEqual([
      [
        'desktop',
        'VirtualDevice',
        { folder: 'build/aarch64-debug/', file: 'player_aarch64.vpkg', redeploy: true }
      ]
    ])
    expect(sandbox.activity().filter((a) => a.action === 'logs')).toHaveLength(1)

    await page.getByRole('button', { name: 'Watching build/' }).click()
    await expect(page.getByRole('button', { name: 'Watch off' })).toBeVisible()
    await expect(toast(page, 'Watch off')).toBeVisible()
  })

  test('hidden with a .vpkg open: only a project folder has a build folder', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const file = makeRecordedVpkg(
      sandbox.home,
      'Downloads/player_aarch64.vpkg',
      'player-aarch64-debug'
    )
    expect((await ovd(sandbox, ['open', file])).exitCode).toBe(0)
    const { page } = await launch()

    await expect(page.getByRole('button', { name: 'Run ▸ player_aarch64.vpkg' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Watch off' })).toHaveCount(0)
  })

  test('turning it on is disabled while the target is offline, with the reason', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    await openPlayerProject(sandbox)
    expect((await ovd(sandbox, ['target', 'set', 'VirtualDevice'])).exitCode).toBe(0)
    sandbox.update((w) => {
      w.vvd.running = false
    })
    const { page } = await launch()

    const watch = page.getByRole('button', { name: 'Watch off' })
    await expect(watch).toBeDisabled()
    await expect(watch).toHaveAttribute('title', 'Vega Virtual Device is offline')

    sandbox.update((w) => {
      w.vvd.running = true
    })
    await expect(watch).toBeEnabled()
    expect(sandbox.activity().filter((a) => a.action === 'build.changed')).toEqual([])
  })
})
