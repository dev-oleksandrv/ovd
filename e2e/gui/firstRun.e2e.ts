import { expect, test } from '../harness/gui.ts'

test.describe('first run', () => {
  test('without the SDK, only the SDK check runs and links the install', async ({
    sandbox,
    launch
  }) => {
    const { page, opened } = await launch()

    await expect(page.getByRole('heading', { name: 'Set up OVD' })).toBeVisible()
    await expect(page.getByText('0 of 3 ready')).toBeVisible()
    const sdk = page.getByRole('region', { name: 'Vega SDK' })
    await expect(sdk.getByText('No Vega SDK found')).toBeVisible()
    for (const name of ['VDA', 'Devices']) {
      await expect(
        page.getByRole('region', { name }).getByText('Waiting for the Vega SDK')
      ).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'SDK not found' })).toBeVisible()

    await sdk.getByRole('link', { name: 'Install the Vega SDK ↗' }).click()
    await expect.poll(opened).toEqual(['https://developer.amazon.com/docs/vega/0.24/'])
    expect(sandbox.calls()).toEqual([])
  })

  test('Doctor stays the start screen: leaving it bounces back', async ({ launch }) => {
    const { page } = await launch()
    await expect(page.getByRole('heading', { name: 'Set up OVD' })).toBeVisible()

    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('button', { name: 'Devices' })
      .click()

    await expect(page.getByRole('heading', { name: 'Set up OVD' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Devices' })).toHaveCount(0)
  })

  test('installing the SDK, starting the Virtual Device and finishing setup', async ({
    sandbox,
    launch
  }) => {
    const { page } = await launch()
    await expect(page.getByRole('heading', { name: 'Set up OVD' })).toBeVisible()

    // The user installs the SDK while the app is open, then re-checks.
    sandbox.installSdk()
    await page
      .getByRole('region', { name: 'Vega SDK' })
      .getByRole('button', { name: 'Re-check' })
      .click()

    await expect(page.getByRole('status').filter({ hasText: 'Vega SDK found' })).toContainText(
      '$ ovd doctor --json'
    )
    await expect(page.getByText('2 of 3 ready')).toBeVisible()
    const devices = page.getByRole('region', { name: 'Devices' })
    await expect(devices.getByText('No devices connected')).toBeVisible()
    await expect(
      devices.getByText('A Fire TV stick shows up only after Developer Mode is on.')
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /SDK 0\.24\.12112/ })).toBeVisible()

    await devices.getByRole('button', { name: /Start the Virtual Device/ }).click()

    await expect(page.getByText('Setup complete — OVD is ready.')).toBeVisible()
    expect(sandbox.calls()).toContain('vega virtual-device start')
    await page.getByRole('button', { name: 'Go to Devices' }).click()
    await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible()
    await expect(
      page
        .getByRole('list', { name: 'Devices' })
        .getByRole('button', { name: /Vega Virtual Device.*Online/ })
    ).toBeVisible()
  })

  test.describe('with only the SDK-bundled vega', () => {
    test('asks for the Vega CLI but lets the user reach Devices', async ({ sandbox, launch }) => {
      sandbox.installSdk('bundled')
      const { page } = await launch()

      const sdk = page.getByRole('region', { name: 'Vega SDK' })
      await expect(sdk.getByRole('link', { name: 'Install the Vega CLI ↗' })).toBeVisible()

      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('button', { name: 'Devices' })
        .click()
      await expect(page.getByRole('heading', { name: 'Devices' })).toBeVisible()
    })
  })
})
