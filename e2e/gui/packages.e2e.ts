import type { ElectronApplication, Page } from '@playwright/test'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { expect, test } from '../harness/gui.ts'
import { makeProject, makeRecordedVpkg, makeVpkg } from '../harness/project.ts'

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

function builds(page: Page) {
  return page.getByRole('list', { name: 'Recent builds' })
}

// The native picker can't be driven, so the next one answers with `path`.
async function nextPick(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, path)
}

// A file dropped from Finder has a path only the preload can read; Playwright can't create
// one, so the drop itself is covered by the renderer tests and these flows use the picker.
test.describe('Packages → Overview', () => {
  test('the open project’s builds are listed and the newest is read with vpt', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    makeProject(sandbox.home, 'player')
    const armv7 = makeRecordedVpkg(
      sandbox.home,
      'dev/player/build/armv7-release/player_armv7.vpkg',
      'player-armv7-release',
      new Date('2026-10-12T09:00:00Z')
    )
    const aarch64 = makeRecordedVpkg(
      sandbox.home,
      'dev/player/build/aarch64-debug/player_aarch64.vpkg',
      'player-aarch64-debug',
      new Date('2026-10-13T09:00:00Z')
    )
    const { app, page } = await launch()
    await nextPick(app, `${sandbox.home}/dev/player`)
    await page
      .getByRole('region', { name: 'Project' })
      .getByRole('button', { name: 'Open a project folder…' })
      .click()
    await expect(page.getByRole('status').filter({ hasText: 'Opened player' })).toBeVisible()

    await nav(page, 'Packages').click()

    const rows = builds(page).getByRole('button')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('player_aarch64.vpkg')
    await expect(rows.nth(0)).toContainText('Debug')
    await expect(rows.nth(1)).toContainText('player_armv7.vpkg')
    await expect(page.getByRole('heading', { name: 'Sample Player 1.4.2 (142)' })).toBeVisible()
    await expect(
      page.getByText('~/dev/player/build/aarch64-debug/player_aarch64.vpkg')
    ).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Install on target' })).toBeDisabled()
    await expect.poll(() => sandbox.calls()).toContain(`vega exec vpt checksum ${aarch64}`)
    expect(sandbox.calls()).not.toContain(`vega exec vpt checksum ${armv7}`)

    await rows.nth(1).click()

    await expect(page.getByText('~/dev/player/build/armv7-release/player_armv7.vpkg')).toBeVisible()
    await expect(page.getByTitle('Copy CLI equivalent')).toHaveText(
      /\$ ovd pkg info ~\/dev\/player\/build\/armv7-release\/player_armv7\.vpkg/
    )
    await expect.poll(() => sandbox.calls()).toContain(`vega exec vpt checksum ${armv7}`)
    // Inspecting a file on the host is not a device action.
    expect(sandbox.activity()).toEqual([])
  })

  test('a .vpkg opened from the drop zone is inspected and listed', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const path = makeRecordedVpkg(
      sandbox.home,
      'Downloads/hellovega_armv7.vpkg',
      'hellovega-armv7-release'
    )
    const { app, page } = await launch()
    await nav(page, 'Packages').click()
    await expect(page.getByText('No packages yet')).toBeVisible()

    await nextPick(app, path)
    await page.getByRole('button', { name: /Drop a \.vpkg here/ }).click()

    await expect(
      page.getByRole('status').filter({ hasText: 'Inspected hellovega_armv7.vpkg' })
    ).toContainText('$ ovd pkg info ~/Downloads/hellovega_armv7.vpkg')
    await expect(
      page.getByRole('heading', {
        name: 'Basic UI React Native Application for project hellovega 0.1.0 (0)'
      })
    ).toBeVisible()
    await expect(page.getByText('any (no native code)')).toBeVisible()
    await expect(builds(page).getByRole('button')).toContainText(['hellovega_armv7.vpkg'])
    // Inspecting doesn't open the file as the project.
    expect(sandbox.hostState()).toBeNull()
  })

  test('a file vpt rejects shows the error and is not listed', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const path = makeVpkg(sandbox.home)
    const { app, page } = await launch()
    await nav(page, 'Packages').click()

    await nextPick(app, path)
    await page.getByRole('button', { name: /Drop a \.vpkg here/ }).click()

    await expect(
      page.getByRole('status').filter({ hasText: 'Not a .vpkg file: player-1.4.2-armv7.vpkg' })
    ).toContainText('$ ovd pkg info')
    await expect(builds(page).getByRole('button')).toHaveCount(0)
    expect(sandbox.calls()).toContain(`vega exec vpt info --json ${path}`)
  })
})

// Opens a project with an armv7 Release build and, when asked, a newer aarch64 Debug build.
async function openPlayer(
  sandbox: { home: string; installSdk: () => void },
  launch: () => Promise<{ app: ElectronApplication; page: Page }>,
  withArmv7 = true
): Promise<{ page: Page; armv7: string; aarch64: string }> {
  sandbox.installSdk()
  makeProject(sandbox.home, 'player')
  const armv7 = `${sandbox.home}/dev/player/build/armv7-release/player_armv7.vpkg`
  if (withArmv7) {
    makeRecordedVpkg(
      sandbox.home,
      'dev/player/build/armv7-release/player_armv7.vpkg',
      'player-armv7-release',
      new Date('2026-10-12T09:00:00Z')
    )
  }
  const aarch64 = makeRecordedVpkg(
    sandbox.home,
    'dev/player/build/aarch64-debug/player_aarch64.vpkg',
    'player-aarch64-debug',
    new Date('2026-10-13T09:00:00Z')
  )
  const { app, page } = await launch()
  await nextPick(app, `${sandbox.home}/dev/player`)
  await page
    .getByRole('region', { name: 'Project' })
    .getByRole('button', { name: 'Open a project folder…' })
    .click()
  await expect(page.getByRole('status').filter({ hasText: 'Opened player' })).toBeVisible()
  await nav(page, 'Packages').click()
  return { page, armv7, aarch64 }
}

test.describe('Install on target behind the architecture guard', () => {
  test.use({ world: { stick: usbStick() } })

  test('an aarch64 build is blocked on the armv7 stick, and the fix installs the armv7 build', async ({
    sandbox,
    launch
  }) => {
    const { page, armv7 } = await openPlayer(sandbox, launch)
    const block = page.getByRole('alert')

    await expect(block).toContainText(
      'Architecture mismatch: package is aarch64, Fire TV stick is armv7. Install is blocked.'
    )
    await page.getByRole('button', { name: 'Install on target' }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Install blocked: architecture mismatch' })
    ).toContainText(
      `$ ovd install ~/dev/player/build/aarch64-debug/player_aarch64.vpkg --device ${STICK_SERIAL}`
    )
    expect(sandbox.calls().some((c) => c.startsWith('vega device install-app'))).toBe(false)

    await block.getByRole('button', { name: 'Use player_armv7.vpkg' }).click()

    await expect(page.getByText('~/dev/player/build/armv7-release/player_armv7.vpkg')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: 'Install on target' }).click()
    const cli = `$ ovd install ~/dev/player/build/armv7-release/player_armv7.vpkg --device ${STICK_SERIAL}`
    await expect(
      page.getByRole('status').filter({ hasText: 'Installed on Fire TV stick' })
    ).toContainText(cli)
    await expect(page.getByTitle('Copy CLI equivalent')).toContainText(cli)
    expect(sandbox.calls()).toContain(
      `vega device install-app -p ${armv7} --device ${STICK_SERIAL}`
    )
    expect(sandbox.world().installed).toEqual([
      { device: STICK_SERIAL, package: 'player-armv7-release' }
    ])
    expect(sandbox.activity()).toEqual([
      expect.objectContaining({
        surface: 'desktop',
        action: 'app.install',
        target: STICK_SERIAL,
        result: 'ok'
      })
    ])
  })

  test('without a matching build, the fix opens the target picker', async ({ sandbox, launch }) => {
    const { page } = await openPlayer(sandbox, launch, false)

    await page.getByRole('alert').getByRole('button', { name: 'Switch target' }).click()

    await expect(page.getByRole('menu', { name: 'Target device' })).toBeVisible()
    expect(sandbox.world().installed).toEqual([])
  })
})
