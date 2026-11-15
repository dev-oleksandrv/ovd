import type { Page } from '@playwright/test'
import { ovd } from '../harness/cli.ts'
import { expect, test } from '../harness/gui.ts'
import { makeProject, makeRecordedVpkg } from '../harness/project.ts'
import type { Sandbox } from '../harness/sandbox.ts'

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

// The recorded broken sample (`build-number = 0`, `launch-type = "sometimes"`, `min = "9.9"`;
// fixtures/0.24/README.md), the newest build of an open project.
async function brokenBuild(sandbox: Sandbox): Promise<string> {
  sandbox.installSdk()
  makeProject(sandbox.home, 'player')
  const path = makeRecordedVpkg(
    sandbox.home,
    'dev/player/build/aarch64-release/player_aarch64.vpkg',
    'player-aarch64-broken'
  )
  // Opened with the CLI: the desktop reads the same host state (ADR 0022).
  expect((await ovd(sandbox, ['open', `${sandbox.home}/dev/player`])).exitCode).toBe(0)
  return path
}

const DISPLAY = '~/dev/player/build/aarch64-release/player_aarch64.vpkg'

test.describe('Packages → Manifest, Files, Validate', () => {
  test('a broken manifest’s errors in Validate, a click opening its line in Manifest', async ({
    sandbox,
    launch
  }) => {
    const path = await brokenBuild(sandbox)
    const { page } = await launch()
    await nav(page, 'Packages').click()
    await expect(page.getByRole('heading', { name: 'Sample Player 1.4.2 (0)' })).toBeVisible()
    const validateTab = page.getByRole('tab', { name: /^Validate/ })
    // No badge before the package is validated: Overview doesn't run vpt validate.
    await expect(validateTab).toHaveText('Validate')

    await validateTab.click()

    await expect(page.getByRole('status').filter({ hasText: '3 errors · 5 notes' })).toBeVisible()
    await expect(validateTab).toHaveText('Validate3')
    await expect(echo(page)).toContainText(`$ ovd pkg validate ${DISPLAY}`)
    const table = page.getByRole('table')
    await expect(table.getByRole('row')).toHaveCount(9)
    await expect(
      table.getByText('[package.build-number] build-number must be greater than 0, found: 0')
    ).toBeVisible()
    await expect(
      table.getByText('[os.version] contains value(s) not in the OS Version registry.')
    ).toBeVisible()
    // vpt gives the OS version error no line, so it opens nothing.
    await expect(table.getByRole('button', { name: '—' })).toHaveCount(0)

    await table.getByRole('button', { name: 'manifest.toml:33:15' }).click()

    await expect(page.getByRole('tab', { name: 'Manifest' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    const line33 = page.getByRole('listitem', { name: 'Line 33' })
    await expect(line33).toHaveAttribute('aria-current', 'true')
    await expect(line33).toContainText('launch-type = "sometimes"')
    await expect(line33).toContainText(
      "[components.interactive.launch-type] 'sometimes' launch type is not supported"
    )
    await expect(line33).toBeInViewport()
    await expect(page.getByRole('listitem', { name: 'Line 7' })).toContainText(
      '[package.build-number] build-number must be greater than 0'
    )
    await expect(echo(page)).toContainText(`$ ovd pkg manifest ${DISPLAY}`)
    expect(sandbox.calls().filter((c) => c.startsWith('vega exec vpt validate'))).toEqual([
      `vega exec vpt validate --no-color ${path}`
    ])
    expect(sandbox.calls()).toContain(`vega exec vpt dump ${path} manifest.toml`)
    expect(sandbox.activity()).toEqual([])
  })

  test('Manifest and Files show the errors too; manifest.toml opens Manifest', async ({
    sandbox,
    launch
  }) => {
    await brokenBuild(sandbox)
    const { page } = await launch()
    await nav(page, 'Packages').click()
    await expect(page.getByRole('heading', { name: 'Sample Player 1.4.2 (0)' })).toBeVisible()

    await page.getByRole('tab', { name: 'Manifest' }).click()

    const line7 = page.getByRole('listitem', { name: 'Line 7' })
    await expect(line7).toContainText('build-number = 0')
    await expect(line7).toContainText('error')
    await expect(line7).toContainText('Provide a positive integer for build-number')
    await expect(page.getByRole('list', { name: 'Notes without a line' })).toContainText(
      "[os.version] contains value(s) not in the OS Version registry.- min: '9.9' is not minted"
    )
    await expect(page.getByRole('tab', { name: /^Validate/ })).toHaveText('Validate3')

    await page.getByRole('tab', { name: 'Files' }).click()

    const tree = page.getByRole('list', { name: 'Files' })
    await expect(tree).toContainText('keplerscript-app-config.json')
    await expect(page.getByText('18 files')).toBeVisible()
    await expect(echo(page)).toContainText(`$ ovd pkg files ${DISPLAY}`)
    const manifest = tree.getByRole('button', { name: /manifest\.toml/ })
    await expect(manifest).toContainText('3 errors')

    await manifest.click()

    await expect(page.getByRole('tab', { name: 'Manifest' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  test('a valid package: no problems badge, Validate again re-runs vpt with its CLI', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    makeProject(sandbox.home, 'player')
    const path = makeRecordedVpkg(
      sandbox.home,
      'dev/player/build/aarch64-release/player_aarch64.vpkg',
      'player-aarch64-release'
    )
    expect((await ovd(sandbox, ['open', `${sandbox.home}/dev/player`])).exitCode).toBe(0)
    const { page } = await launch()
    await nav(page, 'Packages').click()
    await expect(page.getByRole('heading', { name: 'Sample Player 1.4.2 (142)' })).toBeVisible()

    await page.getByRole('tab', { name: /^Validate/ }).click()

    await expect(page.getByRole('status').filter({ hasText: 'Valid · 5 notes' })).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Validate/ })).toHaveText('Validate')

    await page.getByRole('button', { name: 'Validate again' }).click()

    await expect(
      page.getByRole('status').filter({ hasText: 'player_aarch64.vpkg is valid' })
    ).toContainText(`$ ovd pkg validate ${DISPLAY}`)
    await expect
      .poll(() => sandbox.calls().filter((c) => c === `vega exec vpt validate --no-color ${path}`))
      .toHaveLength(2)
  })
})
