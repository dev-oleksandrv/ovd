import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '../harness/gui.ts'
import { BROKEN_MANIFEST, makeProject, makeRecordedVpkg, makeVpkg } from '../harness/project.ts'

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

function card(page: Page) {
  return page.getByRole('region', { name: 'Project' })
}

function row(page: Page, name: string) {
  return page.getByRole('list', { name: 'Checks' }).getByRole('listitem').filter({ hasText: name })
}

function toast(page: Page, text: string) {
  return page.getByRole('status').filter({ hasText: text })
}

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

// The native picker can't be driven, so the next one answers with `path` (or is cancelled).
async function nextPick(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () =>
      picked === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [picked] }
  }, path)
}

// Drops `path` onto the window, as a file dragged from Finder. The preload reads a dropped
// file's path with webUtils.getPathForFile, which needs a File backed by a real path; Playwright
// creates one only through a file input, so the File comes from a hidden input (harness, not
// app UI) and is moved into a synthetic drop. The app's drop handler, preload and IPC run as is.
const DROP_INPUT = 'ovd-e2e-drop-input'
async function dropFile(page: Page, path: string): Promise<void> {
  await page.evaluate((id) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.id = id
    input.hidden = true
    document.body.append(input)
  }, DROP_INPUT)
  await page.locator(`#${DROP_INPUT}`).setInputFiles(path)
  await page.evaluate((id) => {
    const input = document.getElementById(id) as HTMLInputElement
    const file = input.files?.[0]
    if (!file) throw new Error('the drop input holds no file')
    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    for (const type of ['dragenter', 'dragover', 'drop']) {
      window.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }))
    }
    input.remove()
  }, DROP_INPUT)
}

// Drops onto the window are driven with dropFile; the other flows use the pickers.
test.describe('project card', () => {
  test('opening a folder switches to project mode and Doctor follows', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    makeProject(sandbox.home)
    const { app, page } = await launch()
    await expect(card(page)).toContainText('No project')
    await expect(card(page)).toContainText('Drop a .vpkg')

    await nextPick(app, `${sandbox.home}/dev/hellovega`)
    await card(page).getByRole('button', { name: 'Open a project folder…' }).click()

    await expect(page.getByRole('status').filter({ hasText: 'Opened hellovega' })).toContainText(
      '$ ovd open ~/dev/hellovega'
    )
    await expect(card(page)).toContainText('~/dev/hellovega')
    await expect(card(page)).toContainText('OS 1.2 · RN 0.83')
    await expect(card(page)).not.toContainText('SDK')
    expect(sandbox.hostState()).toMatchObject({ project: { kind: 'folder' } })

    await nav(page, 'Doctor').click()
    await expect(row(page, 'Project')).toContainText('vega project doctor · 0 errors, 1 warning')
    expect(sandbox.calls()).toContain('vega project doctor')
  })

  test('clicking the no-project card opens a .vpkg', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const vpkg = makeVpkg(sandbox.home)
    const { app, page } = await launch()

    await nextPick(app, vpkg)
    await card(page)
      .getByRole('button', { name: /No project/ })
      .click()

    await expect(
      page.getByRole('status').filter({ hasText: 'Loaded player-1.4.2-armv7.vpkg' })
    ).toContainText('$ ovd open ~/Downloads/player-1.4.2-armv7.vpkg')
    await expect(card(page)).toContainText('player-1.4.2-armv7.vpkg')
    expect(sandbox.hostState()).toMatchObject({ project: { kind: 'vpkg', path: vpkg } })
  })

  test('opening a folder, then dropping a .vpkg, switches modes and Packages and Doctor follow', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    makeProject(sandbox.home, 'player')
    makeRecordedVpkg(
      sandbox.home,
      'dev/player/build/aarch64-debug/player_aarch64.vpkg',
      'player-aarch64-debug'
    )
    const vpkg = makeRecordedVpkg(
      sandbox.home,
      'Downloads/player_armv7.vpkg',
      'player-armv7-release'
    )
    const { app, page } = await launch()
    const builds = page.getByRole('list', { name: 'Recent builds' }).getByRole('button')

    await nextPick(app, `${sandbox.home}/dev/player`)
    await card(page).getByRole('button', { name: 'Open a project folder…' }).click()

    await expect(toast(page, 'Opened player')).toContainText('$ ovd open ~/dev/player')
    await expect(echo(page)).toContainText('$ ovd open ~/dev/player')
    await expect(card(page)).toContainText('~/dev/player')
    await expect(card(page)).toContainText('OS 1.2 · RN 0.83')
    expect(sandbox.hostState()).toMatchObject({ project: { kind: 'folder' } })

    await nav(page, 'Doctor').click()
    await expect(row(page, 'Project')).toContainText('vega project doctor · 0 errors, 1 warning')

    await nav(page, 'Packages').click()
    await expect(builds).toHaveCount(1)
    await expect(builds).toContainText(['player_aarch64.vpkg'])
    await expect(
      page.getByText('~/dev/player/build/aarch64-debug/player_aarch64.vpkg', { exact: true })
    ).toBeVisible()

    // Doctor ran at launch and on the switch to the folder; its Project row settled above, so
    // clearing now means the doctor run after the drop can't be mixed up with those.
    sandbox.clearCalls()
    // Packages stays open: it lists builds again when the project changes.
    await dropFile(page, vpkg)

    await expect(toast(page, 'Loaded player_armv7.vpkg')).toContainText(
      '$ ovd open ~/Downloads/player_armv7.vpkg'
    )
    await expect(echo(page)).toContainText('$ ovd open ~/Downloads/player_armv7.vpkg')
    await expect(card(page)).toContainText('No project')
    await expect(card(page)).toContainText('player_armv7.vpkg')
    expect(sandbox.hostState()).toMatchObject({ project: { kind: 'vpkg', path: vpkg } })
    await expect(builds).toHaveCount(1)
    await expect(builds).toContainText(['player_armv7.vpkg'])
    await expect(page.getByText('~/Downloads/player_armv7.vpkg', { exact: true })).toBeVisible()

    await nav(page, 'Doctor').click()
    await expect(row(page, 'Project')).toContainText(
      'No project open · installing from player_armv7.vpkg'
    )
    expect(sandbox.calls()).not.toContain('vega project doctor')
  })

  test('a folder that is not a project is refused and nothing changes', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    makeProject(sandbox.home, 'plain', { manifest: null })
    const { app, page } = await launch()

    await nextPick(app, `${sandbox.home}/dev/plain`)
    await card(page).getByRole('button', { name: 'Open a project folder…' }).click()

    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Not a Vega project: no manifest.toml in ~/dev/plain' })
    ).toBeVisible()
    await expect(card(page)).toContainText('No project')
    expect(sandbox.hostState()).toBeNull()
  })
})

test.describe('Doctor → Project', () => {
  test('nothing open: "Open folder…" opens a project', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    makeProject(sandbox.home)
    const { app, page } = await launch()
    await nav(page, 'Doctor').click()
    await expect(row(page, 'Project')).toContainText('No project open')

    await nextPick(app, `${sandbox.home}/dev/hellovega`)
    await row(page, 'Project').getByRole('button', { name: 'Open folder…' }).click()

    await expect(row(page, 'Project')).toContainText('vega project doctor · 0 errors, 1 warning')
    await expect(card(page)).toContainText('hellovega')
  })

  test('Details shows every check, the fix hints and re-runs doctor', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    makeProject(sandbox.home, 'hellovega', { manifest: BROKEN_MANIFEST })
    const { app, page } = await launch()
    await nextPick(app, `${sandbox.home}/dev/hellovega`)
    await card(page).getByRole('button', { name: 'Open a project folder…' }).click()
    await nav(page, 'Doctor').click()
    await expect(row(page, 'Project')).toContainText(
      'vega project doctor · 2 checks failed, 2 warnings'
    )

    await row(page, 'Project').getByRole('button', { name: 'Details' }).click()

    const dialog = page.getByRole('dialog', { name: 'Project doctor · hellovega' })
    await expect(dialog).toContainText('~/dev/hellovega')
    const checks = dialog.getByRole('list', { name: 'Project checks' }).getByRole('listitem')
    await expect(checks).toHaveCount(11)
    await expect(checks.filter({ hasText: 'OS versions valid' })).toContainText(
      'min "9.9" not in [1.2]'
    )
    await expect(dialog).toContainText('Remove unknown scoped packages or check OS version')
    await expect(dialog).toContainText('2 checks failed, 2 warnings')

    // The user fixes the manifest, then re-runs from the dialog.
    makeProject(sandbox.home)
    await dialog.getByRole('button', { name: 'Re-run' }).click()

    await expect(
      page.getByRole('status').filter({ hasText: 'Project doctor finished' })
    ).toContainText('$ ovd doctor')
    await expect(dialog).toContainText('1 warning')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})
