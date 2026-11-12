import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { expect, PALETTE_KEY, test } from '../harness/gui.ts'

const SYNTHETIC = readFileSync(
  new URL('../../fixtures/0.24/vda-pull/synthetic-screenshot.png', import.meta.url)
)

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

async function openRemote(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: 'Remote & Screen' })
    .click()
  await expect(page.getByRole('heading', { name: 'Remote & Screen', level: 1 })).toBeVisible()
}

const pngs = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.')) : []

test.describe('Screenshot on the Virtual Device', () => {
  test.use({ world: { vvd: { running: true, developerMode: true } } })

  test('Screenshot saves the PNG, copies it, toasts it and lists it under Captures', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const desktop = await launch()
    const { page } = desktop
    await openRemote(page)
    await expect(page.getByText('Emulator gRPC · Vega Virtual Device')).toBeVisible()
    await expect(page.getByText('No screenshots yet')).toBeVisible()

    await page.getByRole('button', { name: 'Screenshot', exact: true }).click()

    await expect(
      page.getByText(/^Saved vega-virtual-device-\d{8}-\d{6}\.png · copied to the clipboard$/)
    ).toBeVisible()
    await expect(echo(page)).toContainText('ovd screenshot --clipboard --device VirtualDevice')
    const list = page.getByRole('list', { name: 'Captures' })
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect(list).toContainText('1920×1080')

    const [file] = pngs(sandbox.captures)
    expect(file).toMatch(/^vega-virtual-device-\d{8}-\d{6}\.png$/)
    const saved = readFileSync(join(sandbox.captures, file ?? ''))
    expect(saved.subarray(1, 4).toString()).toBe('PNG')
    // The desktop's clipboard hook got the same PNG; the real clipboard was never touched.
    expect(readFileSync(sandbox.clipboardFile).equals(saved)).toBe(true)
    expect(sandbox.grpcCalls().filter((c) => c.method === 'getScreenshot')).toHaveLength(1)
    expect(sandbox.activity().filter((a) => a.action === 'screenshot')).toEqual([
      expect.objectContaining({
        surface: 'desktop',
        target: 'VirtualDevice',
        args: { backend: 'grpc' },
        result: 'ok'
      })
    ])

    // Show in folder is view-only: the file manager gets the capture, no new echo.
    await list.getByRole('button', { name: 'Show in folder' }).click()
    await expect.poll(() => desktop.shown()).toEqual([expect.stringContaining(file ?? '')])
    await expect(echo(page)).toContainText('ovd screenshot --clipboard --device VirtualDevice')
  })
})

test.describe('Screenshot on a stick', () => {
  test.use({ world: { stick: usbStick() } })

  test('the palette’s Take screenshot runs the same take', async ({ sandbox, launch }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await openRemote(page)
    await expect(page.getByText('inputd-cli · Fire TV stick')).toBeVisible()

    await page.keyboard.press(PALETTE_KEY)
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await palette.getByRole('combobox', { name: 'Command' }).fill('Take screenshot')
    await palette.getByRole('option', { name: /Take screenshot/ }).click()

    await expect(
      page.getByText(/^Saved fire-tv-stick-\d{8}-\d{6}\.png · copied to the clipboard$/)
    ).toBeVisible()
    await expect(echo(page)).toContainText(`ovd screenshot --clipboard --device ${STICK_SERIAL}`)
    await expect(page.getByRole('list', { name: 'Captures' }).getByRole('listitem')).toHaveCount(1)
    const [file] = pngs(sandbox.captures)
    expect(readFileSync(join(sandbox.captures, file ?? '')).equals(SYNTHETIC)).toBe(true)
    const calls = sandbox.calls()
    const shooter = calls.find((c) => c.includes('gwsi-tool-screenshooter')) ?? ''
    const remote = shooter.split(' ').at(-1) ?? ''
    expect(remote).toMatch(/^\/tmp\/ovd-screenshot-[0-9a-f]{8}\.png$/)
    expect(calls).toContain(`vega exec vda -s ${STICK_SERIAL} shell rm -f ${remote}`)
    expect(sandbox.world().stickFiles).toEqual([])
  })

  test('an offline target: Screenshot is disabled with the reason, nothing runs', async ({
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
    await openRemote(page)

    const button = page.getByRole('button', { name: 'Screenshot', exact: true })
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('title', 'Fire TV stick is offline')
    await page.keyboard.press(PALETTE_KEY)
    await page
      .getByRole('dialog', { name: 'Command palette' })
      .getByRole('combobox', { name: 'Command' })
      .fill('Take screenshot')
    await expect(page.getByRole('option', { name: /Take screenshot/ })).toContainText(
      'Unavailable · No online target'
    )
    expect(sandbox.calls().filter((c) => c.includes('gwsi-tool-screenshooter'))).toEqual([])
    expect(pngs(sandbox.captures)).toEqual([])
  })
})
