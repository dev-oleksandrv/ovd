import type { Page } from '@playwright/test'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { expect, test } from '../harness/gui.ts'
import { stillRunning } from '../harness/sandbox.ts'

const CONSOLE = `vega exec vda -s ${STICK_SERIAL} shell inputd-cli start`

function nav(page: Page, name: string) {
  return page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name })
}

function echo(page: Page) {
  return page.getByTitle('Copy CLI equivalent')
}

function pad(page: Page) {
  return page.getByRole('group', { name: 'Remote' })
}

async function openRemote(page: Page): Promise<void> {
  await nav(page, 'Remote & Screen').click()
  await expect(page.getByRole('heading', { name: 'Remote & Screen', level: 1 })).toBeVisible()
}

test.describe('Remote & Screen on a stick', () => {
  test.use({ world: { stick: usbStick() } })

  test('the pad and the arrow keys reach the stick’s console, each with its CLI echo', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const desktop = await launch()
    const { page } = desktop
    await openRemote(page)
    await expect(page.getByText('inputd-cli · Fire TV stick')).toBeVisible()

    await pad(page).getByRole('button', { name: 'Down' }).click()
    await expect(echo(page)).toContainText(`ovd input press down --device ${STICK_SERIAL}`)
    await page.keyboard.press('ArrowRight')
    await expect(echo(page)).toContainText(`ovd input press right --device ${STICK_SERIAL}`)
    await expect(page.getByRole('list', { name: 'Sent' }).getByRole('listitem')).toHaveCount(2)

    expect(sandbox.calls().filter((c) => c === CONSOLE)).toHaveLength(1)
    expect(sandbox.inputConsole()).toEqual(['button_press KEY_DOWN', 'button_press KEY_RIGHT'])
    expect(sandbox.activity().filter((a) => a.action === 'input.press')).toEqual([
      expect.objectContaining({
        surface: 'desktop',
        target: STICK_SERIAL,
        args: { keys: 'down', backend: 'inputd-cli' }
      }),
      expect.objectContaining({
        surface: 'desktop',
        target: STICK_SERIAL,
        args: { keys: 'right', backend: 'inputd-cli' }
      })
    ])

    // The console exits with the app.
    await desktop.quit()
    await expect.poll(() => stillRunning(sandbox.inputConsolePids())).toEqual([])
    expect(sandbox.inputConsole().at(-1)).toBe('exit')
  })

  test('typing into "Type into TV" fires no remote keys; Send types the text', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await openRemote(page)
    const field = page.getByRole('textbox', { name: 'Text to type' })
    await expect(field).toBeVisible()

    // `h` is Home and `m` Menu on the keyboard's remote, Space play/pause.
    await field.pressSequentially('hm home')
    await field.press('ArrowLeft')
    await page.getByRole('button', { name: 'Send' }).click()

    await expect(echo(page)).toContainText(`ovd input text "hm home" --device ${STICK_SERIAL}`)
    await expect(field).toHaveValue('')
    expect(sandbox.inputConsole()).toEqual(['send_text "hm home"'])
    expect(JSON.stringify(sandbox.activity())).not.toContain('hm home')
  })

  test('an offline target: Remote unavailable, and no console starts', async ({
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

    await expect(page.getByText('Remote unavailable — Fire TV stick is offline')).toBeVisible()
    expect(sandbox.calls()).not.toContain(CONSOLE)
  })
})

test.describe('Remote & Screen on the Virtual Device', () => {
  test.use({ world: { vvd: { running: true, developerMode: true } } })

  test('Home is disabled with the reason; OK reaches gRPC as KEY_KPENTER', async ({
    sandbox,
    launch
  }) => {
    sandbox.installSdk()
    const { page } = await launch()
    await openRemote(page)
    await expect(page.getByText('Emulator gRPC · Vega Virtual Device')).toBeVisible()

    const home = pad(page).getByRole('button', { name: 'Home' })
    await expect(home).toBeDisabled()
    await expect(home).toHaveAttribute('title', 'Home can’t be sent to the Virtual Device')
    await page.keyboard.press('h')

    await pad(page).getByRole('button', { name: 'OK' }).click()

    await expect(echo(page)).toContainText('ovd input press ok --device VirtualDevice')
    // gRPC was off (the Virtual Device wasn't started by OVD): turned on once, then the key.
    await expect
      .poll(() => sandbox.grpcCalls().filter((c) => c.method === 'sendKey'))
      .toEqual([
        { method: 'sendKey', codeType: 1, eventType: 0, keyCode: 96 },
        { method: 'sendKey', codeType: 1, eventType: 1, keyCode: 96 }
      ])
    expect(sandbox.activity().map((a) => a.action)).toEqual(['vvd.grpc.enable', 'input.press'])
  })
})
