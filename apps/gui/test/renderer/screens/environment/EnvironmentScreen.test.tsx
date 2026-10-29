import type { DoctorReport } from '@ovd/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { IpcResult, OvdApi } from '../../../../src/preload/api'
import { App } from '../../../../src/renderer/src/App'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { doctorReport, ready, stubOvd } from '../../support/ovdStub'
import { stick, vvd } from '../devices/sample'

const ok = (data: DoctorReport): IpcResult<DoctorReport> => ({ ok: true, data })

const noSdk = doctorReport({
  sdk: {
    status: 'fail',
    detail: 'No Vega SDK found',
    hint: 'Install the Vega SDK',
    fix: 'install-sdk'
  },
  vda: { status: 'skipped', detail: 'Waiting for the Vega SDK' },
  devices: { status: 'skipped', detail: 'Waiting for the Vega SDK' },
  devmode: { status: 'skipped', detail: 'Waiting for the Vega SDK' },
  metro: { status: 'skipped', detail: 'Waiting for the Vega SDK' }
})
const bundledCli = doctorReport({
  sdk: {
    status: 'fail',
    detail: 'Vega CLI (SDK Manager) not found — this vega is the one bundled with the SDK',
    fix: 'install-cli'
  },
  devmode: { status: 'skipped', detail: 'Needs the Vega CLI (SDK Manager)' }
})
const noDevices = doctorReport({
  devices: { status: 'warn', detail: 'No devices connected', fix: 'start-vvd' }
})

// Each call to doctor.run answers with the next report; the last one repeats.
async function renderApp(...reports: DoctorReport[]): Promise<OvdApi> {
  let call = 0
  const { api } = stubOvd({
    list: async () => ready([stick, vvd], stick.id),
    devices: [stick, vvd],
    doctor: () => ok(reports[Math.min(call++, reports.length - 1)] ?? doctorReport())
  })
  render(
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  )
  await screen.findByRole('list', { name: 'Devices' }).catch(() => undefined)
  return api
}

const nav = (name: string) =>
  within(screen.getByRole('navigation', { name: 'Main' })).getByRole('button', { name })

describe('first run', () => {
  test('without the SDK, the app opens on Doctor with the install link', async () => {
    await renderApp(noSdk)
    expect(await screen.findByText('Set up OVD')).toBeTruthy()
    expect(
      screen.getByText(
        'Doctor stays the start screen until the Vega SDK and VDA pass · 0 of 3 ready'
      )
    ).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Install the Vega SDK ↗' })
    expect(link.getAttribute('href')).toBe('https://developer.amazon.com/docs/vega/0.24/')
    expect(screen.getAllByText('Waiting for the Vega SDK').length).toBeGreaterThan(0)
    expect(screen.getByText('macOS 26.6 · arm64 · Node 24.2.0')).toBeTruthy()
  })

  test('only the bundled vega offers the Vega CLI install', async () => {
    await renderApp(bundledCli)
    expect(await screen.findByRole('link', { name: 'Install the Vega CLI ↗' })).toBeTruthy()
  })

  test('navigating away bounces back while the SDK fails', async () => {
    await renderApp(noSdk)
    await screen.findByText('Set up OVD')
    fireEvent.click(nav('Devices'))
    expect(screen.getByText('Set up OVD')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Devices' })).toBeNull()
  })

  test('Re-check runs doctor again and completing setup offers Go to Devices', async () => {
    const api = await renderApp(noSdk, doctorReport())
    await screen.findByText('Set up OVD')
    fireEvent.click(screen.getAllByRole('button', { name: 'Re-check' })[0] as HTMLElement)
    expect(await screen.findByText('Re-checking…')).toBeTruthy()
    expect(await screen.findByText('Setup complete — OVD is ready.')).toBeTruthy()
    expect(await screen.findByText('Vega SDK found')).toBeTruthy()
    expect(api.doctor.run).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Go to Devices' }))
    expect(await screen.findByRole('heading', { name: 'Devices' })).toBeTruthy()
  })

  test('with the SDK and VDA working, no devices does not block the app', async () => {
    await renderApp(noDevices)
    await screen.findByText('Doctor')
    expect(screen.queryByText('Set up OVD')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Devices' })).toBeTruthy()
  })
})

describe('Doctor tab', () => {
  test('the sidebar opens Doctor with the summary and every row', async () => {
    await renderApp(noDevices)
    fireEvent.click(nav('Doctor'))
    expect(await screen.findByText('0 failing · 1 warning')).toBeTruthy()
    const rows = screen.getByRole('list', { name: 'Checks' })
    expect(within(rows).getAllByRole('listitem')).toHaveLength(6)
    expect(within(rows).getByText('No devices connected')).toBeTruthy()
    expect(within(rows).getByText('vega exec vda devices -l')).toBeTruthy()
  })

  test('Run ovd doctor runs it again, toasts and echoes the command', async () => {
    const api = await renderApp(doctorReport())
    fireEvent.click(nav('Doctor'))
    await screen.findByText('All checks passed')
    fireEvent.click(screen.getByRole('button', { name: 'Run ovd doctor' }))
    expect(await screen.findByText('ovd doctor finished')).toBeTruthy()
    expect(screen.getAllByText(/ovd doctor --json/).length).toBeGreaterThan(0)
    expect(api.doctor.run).toHaveBeenCalledTimes(2)
  })

  test('a failed doctor call shows the error with its hint', async () => {
    stubOvd({
      list: async () => ready([stick, vvd], stick.id),
      doctor: () => ({
        ok: false,
        error: { code: 'COMMAND_FAILED', message: 'Doctor broke', hint: 'Try again' }
      })
    })
    render(
      <FeedbackProvider>
        <App />
      </FeedbackProvider>
    )
    fireEvent.click(nav('Doctor'))
    expect(await screen.findByText('Doctor broke')).toBeTruthy()
    expect(screen.getByText('Try again')).toBeTruthy()
  })

  test('the SDK item in the status bar opens Doctor', async () => {
    await renderApp(doctorReport())
    fireEvent.click(await screen.findByRole('button', { name: 'SDK 0.24.12112' }))
    expect(await screen.findByText('All checks passed')).toBeTruthy()
  })
})
