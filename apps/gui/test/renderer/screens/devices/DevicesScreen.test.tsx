import type { Device, DevicesUpdate } from '@ovd/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { OvdApi } from '../../../../src/preload/api'
import { App } from '../../../../src/renderer/src/App'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ready, stubOvd } from '../../support/ovdStub'
import { stick, vvd } from './sample'

const secondStick: Device = {
  ...stick,
  id: 'G070000000000002',
  vdaSerial: 'G070000000000002',
  serial: 'G070000000000002',
  name: 'Fire TV stick 0002',
  isTarget: false
}

let api: OvdApi
let push: (update: DevicesUpdate) => void

function stub(list: () => Promise<DevicesUpdate>): void {
  ;({ api, push } = stubOvd({ list, devices: [stick, secondStick, vvd] }))
}

function renderApp(): void {
  render(
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  )
}

describe('Devices screen', () => {
  test('shows loading, then the devices with the target badge and status', async () => {
    let resolve: (u: DevicesUpdate) => void = () => {}
    stub(() => new Promise((r) => (resolve = r)))
    renderApp()
    expect(screen.getByText('Loading devices…')).toBeTruthy()
    await act(async () => resolve(ready([stick, vvd], stick.id)))
    const list = screen.getByRole('list', { name: 'Devices' })
    expect(within(list).getByText('Fire TV stick')).toBeTruthy()
    expect(within(list).getByText('Target')).toBeTruthy()
    expect(within(list).getByText('USB · armv7 · OS 2.0')).toBeTruthy()
    expect(within(list).getByText('Stopped')).toBeTruthy()
    expect(
      screen.getByText(
        'Discovered over USB, TCP/IP and the local Virtual Device · refreshes every 2 s'
      )
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Devices' }).getAttribute('aria-current')).toBe(
      'page'
    )
  })

  test('the detail of the target shows its info and the device info JSON', async () => {
    stub(async () => ready([stick, vvd], stick.id))
    renderApp()
    expect(await screen.findByText('TV Ship/529')).toBeTruthy()
    expect(screen.getByText('vega device info')).toBeTruthy()
    expect(screen.getByText(/"architecture": "armv7l"/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use as target' })).toBeNull()
  })

  test('empty', async () => {
    stub(async () => ready([]))
    renderApp()
    expect(await screen.findByText('No devices yet')).toBeTruthy()
    expect(
      screen.getByText('Start the Virtual Device, or set up a Fire TV stick with Developer Mode.')
    ).toBeTruthy()
  })

  test('error shows the message and the fix hint', async () => {
    stub(async () => ({
      ok: false,
      error: { code: 'SDK_NOT_FOUND', message: 'No Vega SDK found', hint: 'Install the Vega SDK' }
    }))
    renderApp()
    expect(await screen.findByText('No Vega SDK found')).toBeTruthy()
    expect(screen.getByText('Install the Vega SDK')).toBeTruthy()
  })

  test('a stopped Virtual Device has no "Use as target" and no info', async () => {
    stub(async () => ready([stick, vvd], stick.id))
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: /Vega Virtual Device/ }))
    expect(screen.getByText('VirtualDevice', { selector: 'span' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use as target' })).toBeNull()
    expect(screen.queryByText('vega device info')).toBeNull()
  })

  test('"Use as target" sets the target and echoes the command', async () => {
    stub(async () => ready([stick, secondStick], stick.id))
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: /Fire TV stick 0002/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use as target' }))
    })
    expect(api.devices.setTarget).toHaveBeenCalledWith('G070000000000002')
    expect(screen.getByText('Target: Fire TV stick 0002')).toBeTruthy()
    expect(screen.getAllByText(/ovd target set G070000000000002/).length).toBeGreaterThan(0)
  })

  test('rename saves on Enter and echoes the command', async () => {
    stub(async () => ready([stick], stick.id))
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    const field = screen.getByRole('textbox', { name: 'Device name' })
    fireEvent.change(field, { target: { value: 'Living room stick' } })
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' })
    })
    expect(api.devices.rename).toHaveBeenCalledWith('G070000000000001', 'Living room stick')
    expect(screen.getByText('Renamed to Living room stick')).toBeTruthy()
    expect(
      screen.getAllByText(/ovd device rename G070000000000001 "Living room stick"/).length
    ).toBeGreaterThan(0)
  })

  test('Escape or an empty name cancels the rename', async () => {
    stub(async () => ready([stick], stick.id))
    renderApp()
    fireEvent.click(await screen.findByRole('button', { name: 'Rename' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Device name' }), { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: 'Device name' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const field = screen.getByRole('textbox', { name: 'Device name' })
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(api.devices.rename).not.toHaveBeenCalled()
  })

  test('a pushed change removes an unplugged stick', async () => {
    stub(async () => ready([stick, vvd], stick.id))
    renderApp()
    const list = await screen.findByRole('list', { name: 'Devices' })
    act(() => push(ready([vvd])))
    expect(within(list).queryByText('Fire TV stick')).toBeNull()
    expect(within(list).getByText('Vega Virtual Device')).toBeTruthy()
  })

  test('Rescan polls now and echoes ovd devices', async () => {
    stub(async () => ready([stick, vvd], stick.id))
    renderApp()
    await screen.findByRole('list', { name: 'Devices' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rescan' }))
    })
    expect(api.devices.list).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Rescanned · 2 devices')).toBeTruthy()
  })
})
