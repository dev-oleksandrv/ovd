import { existsSync, readdirSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { expect, test } from '../harness/gui.ts'

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

function pad(page: Page) {
  return page.getByRole('group', { name: 'Remote' })
}

function screenCard(page: Page) {
  return page.getByRole('region', { name: 'Screen' })
}

async function openRemote(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Remote & Screen' })
    .click()
  await expect(page.getByRole('heading', { name: 'Remote & Screen', level: 1 })).toBeVisible()
  // A hidden document draws nothing (the view pauses): the harness window must be visible.
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible')
}

const pngs = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : []

const frames = async (page: Page) =>
  Number(await page.getByLabel('Live · emulator gRPC', { exact: true }).getAttribute('data-frames'))

test.describe('The live view of the Virtual Device', () => {
  test.use({ world: { vvd: { running: true, developerMode: true } } })

  test('streams the screen, a pad key brings a new frame, and a stop shows No signal', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    // Remembered as the target, so it stays the target once it is stopped.
    expect((await ovd(sandbox, ['target', 'set', 'VirtualDevice'])).exitCode).toBe(0)
    const { page } = await launch()
    await openRemote(page)

    await expect(screenCard(page).getByText('Live · emulator gRPC')).toBeVisible()
    await expect.poll(() => frames(page)).toBeGreaterThanOrEqual(1)
    const before = await frames(page)

    // A key changes the screen: the emulator sends the next frame.
    await expect(page.getByText('Emulator gRPC · Vega Virtual Device')).toBeVisible()
    await pad(page).getByRole('button', { name: 'Down' }).click()
    await expect(echo(page)).toContainText('ovd input press down --device VirtualDevice')
    await expect.poll(() => frames(page)).toBeGreaterThan(before)

    expect(sandbox.grpcCalls().filter((c) => c.method === 'streamScreenshot')).toHaveLength(1)
    // One entry for the view, and gRPC (off at first) turned on once for it and the remote.
    expect(sandbox.activity().filter((a) => a.action === 'screen.live')).toEqual([
      expect.objectContaining({
        surface: 'desktop',
        target: 'VirtualDevice',
        args: { backend: 'grpc' },
        result: 'ok'
      })
    ])
    expect(sandbox.activity().filter((a) => a.action === 'vvd.grpc.enable')).toHaveLength(1)

    // Another surface stops the Virtual Device: the emulator ends the stream.
    expect((await ovd(sandbox, ['vvd', 'stop'])).exitCode).toBe(0)
    await expect(screenCard(page).getByText('No signal')).toBeVisible()
    await expect(screenCard(page).getByText('Vega Virtual Device is stopped')).toBeVisible()
    expect(sandbox.activity().filter((a) => a.action === 'screen.live')).toHaveLength(1)
  })
})

test.describe('The latest screenshot of a stick', () => {
  test.use({ world: { stick: usbStick() } })

  test('Refresh shows a screenshot, echoes ovd screenshot, and a key makes it out of date', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await openRemote(page)
    const card = screenCard(page)
    await expect(card.getByText('No screenshot yet')).toBeVisible()

    await card.getByRole('button', { name: 'Refresh' }).click()

    await expect(card.getByText(/^Latest screenshot · \d{2}:\d{2}:\d{2}$/)).toBeVisible()
    await expect(card.getByRole('img', { name: /^Latest screenshot · / })).toBeVisible()
    await expect(page.getByText(/^Saved fire-tv-stick-\d{8}-\d{6}\.png$/)).toBeVisible()
    await expect(echo(page)).toContainText(`ovd screenshot --device ${STICK_SERIAL}`)
    // Refresh is `ovd screenshot`: saved and listed, without the clipboard.
    expect(pngs(sandbox.captures)).toHaveLength(1)
    await expect(page.getByRole('list', { name: 'Captures' }).getByRole('listitem')).toHaveCount(1)
    expect(sandbox.clipboardCalls()).toEqual([])
    expect(sandbox.activity().filter((a) => a.action === 'screenshot')).toEqual([
      expect.objectContaining({ surface: 'desktop', target: STICK_SERIAL, result: 'ok' })
    ])
    expect(sandbox.grpcCalls()).toEqual([])
    await expect(card.getByText('Out of date')).toHaveCount(0)

    await expect(page.getByText('inputd-cli · Fire TV stick')).toBeVisible()
    await pad(page).getByRole('button', { name: 'Down' }).click()
    await expect(echo(page)).toContainText(`ovd input press down --device ${STICK_SERIAL}`)
    await expect(card.getByText('Out of date')).toBeVisible()
  })

  test('an offline stick: No signal above Remote unavailable', async ({ sandbox, launch }) => {
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
    await openRemote(page)

    await expect(screenCard(page).getByText('No signal')).toBeVisible()
    await expect(screenCard(page).getByText('Fire TV stick is offline')).toBeVisible()
    await expect(page.getByText('Remote unavailable — Fire TV stick is offline')).toBeVisible()
    expect(sandbox.calls().filter((c) => c.includes('gwsi-tool-screenshooter'))).toEqual([])
  })
})
