import { usbStick } from '../fake-sdk/world.ts'
import { expect, test } from '../harness/gui.ts'

function nav(page: import('@playwright/test').Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

function row(page: import('@playwright/test').Page, name: string) {
  return page.getByRole('list', { name: 'Checks' }).getByRole('listitem').filter({ hasText: name })
}

test.describe('Doctor after setup', () => {
  test.use({ world: { stick: usbStick(), account: 'signed-out', browserSignIn: 'never' } })

  test('opens on Devices and reports the same checks as ovd doctor', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()

    // The SDK and VDA pass, so first run is skipped.
    await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible()
    await nav(page, 'Doctor').click()

    await expect(page.getByText('0 failing · 1 warning')).toBeVisible()
    await expect(row(page, 'Vega SDK')).toContainText(
      '0.24.12112 · Vega CLI 1.4.5 · ~/vega/bin/vega'
    )
    await expect(row(page, 'Devices')).toContainText('1 online · 1 unavailable')
    await expect(row(page, 'Developer Mode')).toContainText(
      'Not signed in — needed to set up a new stick'
    )
    await expect(row(page, 'Metro')).toContainText('not reversed on Fire TV stick')

    await page.getByRole('button', { name: 'Run ovd doctor' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'ovd doctor finished' })).toContainText(
      '$ ovd doctor --json'
    )
    // Doctor only reads: the sign-in it probed was stopped, not left waiting.
    expect(sandbox.world().account).toBe('signed-out')
  })

  test('the Developer Mode row opens the new-stick wizard', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await nav(page, 'Doctor').click()

    await row(page, 'Developer Mode').getByRole('button', { name: 'Set up' }).click()

    await expect(page.getByRole('dialog', { name: 'Set up a new stick' })).toBeVisible()
  })
})

test.describe('Virtual Device with Developer Mode off', () => {
  test.use({ world: { vvd: { running: true, developerMode: false } } })

  test('Doctor offers Enable, and the row passes after it', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await nav(page, 'Doctor').click()
    const devmode = row(page, 'Developer Mode')
    await expect(devmode).toContainText('Developer Mode is off on the Virtual Device')

    await devmode.getByRole('button', { name: 'Enable' }).click()

    await expect(page.getByRole('status').filter({ hasText: 'Developer Mode on' })).toContainText(
      '$ ovd vvd devmode enable'
    )
    await expect(devmode).toContainText('Signed in to Amazon Developer Services')
    expect(sandbox.world().vvd.developerMode).toBe(true)
  })
})

test.describe('VDA not answering', () => {
  test.use({ world: { vda: 'broken' } })

  test('keeps the user on first run with the VDA check failing', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()

    await expect(page.getByRole('heading', { name: 'Set up OVD' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'VDA' })).toContainText(
      'vega exec vda version didn’t respond'
    )

    // VDA comes back; Re-check moves on.
    sandbox.update((w) => (w.vda = 'ok'))
    await page
      .getByRole('region', { name: 'VDA' })
      .getByRole('button', { name: 'Re-check' })
      .click()
    await expect(page.getByRole('status').filter({ hasText: 'VDA responded' })).toBeVisible()
  })
})
