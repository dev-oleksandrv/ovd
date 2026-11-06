import type { AppDetails, AppList, Device } from '@ovd/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { IpcResult, OvdApi } from '../../../../src/preload/api'
import { App } from '../../../../src/renderer/src/App'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ready, stubOvd } from '../../support/ovdStub'
import { listFor, player } from '../apps/sample'
import { stick, vvd } from './sample'

function renderWith(devices: Device[], target: string): OvdApi {
  const { api } = stubOvd({
    list: async () => ready(devices, target),
    devices,
    apps: {
      list: async (device: string): Promise<IpcResult<AppList>> => ({
        ok: true,
        data: listFor(device, 'Fire TV stick', device === stick.id ? [player] : [])
      }),
      info: async (): Promise<IpcResult<AppDetails>> => ({
        ok: true,
        data: { target: { id: stick.id, name: 'Fire TV stick' }, app: player }
      })
    }
  })
  render(
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  )
  return api
}

describe('Devices → Running now', () => {
  test('lists the apps running on the device, with pid and state', async () => {
    const api = renderWith([stick, vvd], stick.id)
    const card = (await screen.findByRole('heading', { name: 'Running now' })).closest('section')
    if (!card) throw new Error('no Running now card')
    expect(await within(card).findByText('Sample Player')).toBeTruthy()
    expect(within(card).getByText('pid 4182 · VISIBLE')).toBeTruthy()
    expect(api.apps.list).toHaveBeenCalledWith(stick.id, true)
  })

  test('All apps → opens the Apps screen', async () => {
    renderWith([stick, vvd], stick.id)
    fireEvent.click(await screen.findByRole('button', { name: 'All apps →' }))
    expect(await screen.findByRole('heading', { name: 'Apps', level: 1 })).toBeTruthy()
  })

  test('a stopped Virtual Device: says so without reading', async () => {
    const api = renderWith([vvd], vvd.id)
    expect(await screen.findByText('Virtual Device is stopped')).toBeTruthy()
    expect(api.apps.list).not.toHaveBeenCalled()
  })
})
