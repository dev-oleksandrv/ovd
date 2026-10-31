import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from '../harness/gui.ts'
import { BROKEN_MANIFEST, makeProject, makeVpkg } from '../harness/project.ts'

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

function card(page: Page) {
  return page.getByRole('region', { name: 'Project' })
}

function row(page: Page, name: string) {
  return page.getByRole('list', { name: 'Checks' }).getByRole('listitem').filter({ hasText: name })
}

// The native picker can't be driven, so the next one answers with `path` (or is cancelled).
async function nextPick(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = async () =>
      picked === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [picked] }
  }, path)
}

// A file dropped from Finder has a path only the preload can read; Playwright can't create
// one, so drops are covered by the renderer tests and these flows use the pickers.
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
