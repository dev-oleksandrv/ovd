import { usbStick } from '../fake-sdk/world.ts'
import { expect, test } from '../harness/gui.ts'
import { stillRunning } from '../harness/sandbox.ts'

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

  test.describe('while the SDK checks run', () => {
    test.use({
      world: {
        stick: usbStick(),
        account: 'signed-out',
        browserSignIn: 'never',
        hold: ['vega sdk config doctor --json']
      }
    })

    test('shows Running checks… until the report arrives', async ({ sandbox, launch }) => {
      sandbox.installSdk()
      const { page } = await launch()
      await nav(page, 'Doctor').click()

      const running = page.getByRole('status').filter({ hasText: 'Running checks…' })
      await expect(running).toBeVisible()
      await expect(page.getByRole('list', { name: 'Checks' })).toHaveCount(0)

      sandbox.update((w) => {
        w.hold = []
      })

      await expect(page.getByText('0 failing · 1 warning')).toBeVisible()
      await expect(row(page, 'Vega SDK')).toContainText('0.24.12112')
      await expect(running).toHaveCount(0)
      expect(sandbox.calls()).toContain('vega sdk config doctor --json')
    })
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

test.describe('Emulator gRPC', () => {
  function toast(page: import('@playwright/test').Page, text: string) {
    return page.getByRole('status').filter({ hasText: text })
  }

  async function startFromDevices(page: import('@playwright/test').Page): Promise<void> {
    await page
      .getByRole('list', { name: 'Devices' })
      .getByRole('button', { name: /Vega Virtual Device/ })
      .click()
    await page.getByRole('button', { name: 'Start Virtual Device' }).click()
  }

  test('starting the Virtual Device turns it on, and Doctor shows its port', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    // The doctor run at launch must finish before the start: its last SDK call is the
    // sign-in probe.
    await expect.poll(() => sandbox.calls()).toContain('vega devmode login --json')
    await startFromDevices(page)
    await expect(toast(page, 'Virtual Device started')).toContainText('$ ovd vvd start')

    await nav(page, 'Doctor').click()
    await page.getByRole('button', { name: 'Run ovd doctor' }).click()

    await expect(row(page, 'Emulator gRPC')).toContainText(
      `On · :${sandbox.env.OVD_EMULATOR_GRPC_PORT}`
    )
    expect(sandbox.grpcCalls()).toEqual([{ method: 'getVmState' }])
    expect(sandbox.activity().map((a) => [a.action, a.result])).toEqual([
      ['vvd.start', 'ok'],
      ['vvd.grpc.enable', 'ok']
    ])
  })

  test.describe('without the console token', () => {
    test.use({ world: { consoleToken: 'missing' } })

    test('the start warns, and Doctor offers Turn on', async ({ sandbox, launch }) => {
      sandbox.installSdk()
      const { page } = await launch()
      await expect.poll(() => sandbox.calls()).toContain('vega devmode login --json')
      await startFromDevices(page)

      const warning = toast(
        page,
        'Virtual Device started, but emulator gRPC couldn’t be turned on.'
      )
      await expect(warning).toContainText(
        'Restart the Virtual Device with ovd vvd stop, then ovd vvd start.'
      )
      await expect(warning).toContainText('$ ovd vvd start')

      await nav(page, 'Doctor').click()
      await page.getByRole('button', { name: 'Run ovd doctor' }).click()
      const grpc = row(page, 'Emulator gRPC')
      await expect(grpc).toContainText('Couldn’t enable')
      await expect(grpc.getByRole('button', { name: 'Turn on' })).toBeVisible()
      expect(sandbox.activity().at(-1)).toMatchObject({
        action: 'vvd.grpc.enable',
        result: 'error',
        errorCode: 'VVD_GRPC_FAILED'
      })
    })
  })

  test.describe('on a running Virtual Device with gRPC off', () => {
    test.use({ world: { vvd: { running: true, developerMode: true } } })

    test('Turn on in Doctor turns it on and the row passes', async ({ sandbox, launch }) => {
      sandbox.installSdk()
      const { page } = await launch()
      await nav(page, 'Doctor').click()
      const grpc = row(page, 'Emulator gRPC')
      await expect(grpc).toContainText('Couldn’t enable')

      await grpc.getByRole('button', { name: 'Turn on' }).click()

      await expect(toast(page, 'Emulator gRPC on')).toContainText('$ ovd vvd start')
      await expect(grpc).toContainText(`On · :${sandbox.env.OVD_EMULATOR_GRPC_PORT}`)
      // Already running: only gRPC was turned on.
      expect(sandbox.calls()).not.toContain('vega virtual-device start')
    })
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

test.describe('Sign-in probe waiting at quit', () => {
  test.use({ world: { account: 'signed-out', browserSignIn: 'never', loginHold: true } })

  test('quitting while the sign-in probe waits leaves no probe', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    // Doctor runs at launch (useDoctor.ts), and its sign-in probe waits until it is stopped.
    const desktop = await launch()
    await expect.poll(() => sandbox.probePids().length, { timeout: 15_000 }).toBeGreaterThan(0)

    await desktop.quit()

    await expect.poll(() => stillRunning(sandbox.probePids())).toEqual([])
  })
})
