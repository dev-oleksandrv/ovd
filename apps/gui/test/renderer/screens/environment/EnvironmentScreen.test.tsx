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

const grpcOff = doctorReport({
  grpc: {
    status: 'warn',
    detail: 'Couldn’t enable',
    hint: 'Turn it on with ovd vvd start',
    fix: 'enable-vvd-grpc'
  }
})

const vvdDevmodeOff = doctorReport({
  devmode: {
    status: 'warn',
    detail: 'Developer Mode is off on the Virtual Device',
    command: 'vega exec vda -s emulator-5554 shell vsm developer-mode',
    hint: 'Turn it on with ovd vvd devmode enable',
    fix: 'enable-vvd-devmode'
  }
})

// Each call to doctor.run answers with the next report; the last one repeats.
async function renderApp(...reports: DoctorReport[]): Promise<OvdApi> {
  return renderWithVvd({}, ...reports)
}

async function renderWithVvd(
  vvdApi: Partial<OvdApi['vvd']>,
  ...reports: DoctorReport[]
): Promise<OvdApi> {
  let call = 0
  const { api } = stubOvd({
    list: async () => ready([stick, vvd], stick.id),
    devices: [stick, vvd],
    doctor: () => ok(reports[Math.min(call++, reports.length - 1)] ?? doctorReport()),
    vvd: {
      start: async () => ({
        ok: true,
        data: {
          running: true,
          status: 'online',
          device: { ...vvd, status: 'online' },
          grpc: { status: 'on', port: 8554 }
        }
      }),
      enableDeveloperMode: async () => ({ ok: true, data: { developerMode: true } }),
      ...vvdApi
    }
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

  test('only the bundled vega offers the Vega CLI install and still lets Devices open', async () => {
    await renderApp(bundledCli)
    expect(await screen.findByRole('link', { name: 'Install the Vega CLI ↗' })).toBeTruthy()
    fireEvent.click(nav('Devices'))
    expect(await screen.findByRole('heading', { name: 'Devices' })).toBeTruthy()
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
    // Re-check runs the whole doctor, so it echoes the CLI equivalent (ADR 0005).
    expect(screen.getAllByText(/ovd doctor --json/).length).toBeGreaterThan(0)
    expect(api.doctor.run).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Go to Devices' }))
    expect(await screen.findByRole('heading', { name: 'Devices' })).toBeTruthy()
  })

  test('clicking Re-check again while a run is in progress does not queue another run', async () => {
    const api = await renderApp(noSdk)
    await screen.findByText('Set up OVD')
    const recheck = screen.getAllByRole('button', { name: 'Re-check' })[0] as HTMLElement
    fireEvent.click(recheck)
    fireEvent.click(recheck)
    await screen.findAllByText('Re-checking…')
    expect(api.doctor.run).toHaveBeenCalledTimes(2)
  })

  test('no devices: the Devices card starts the Virtual Device, then checks again', async () => {
    const api = await renderApp(noSdk, noDevices, doctorReport())
    fireEvent.click(await screen.findByRole('button', { name: 'Re-check' }))
    const card = await screen.findByRole('region', { name: 'Devices' })
    expect(
      within(card).getByText('Runs locally on this computer · aarch64 on Apple Silicon')
    ).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: /Start the Virtual Device/ }))
    expect(api.vvd.start).toHaveBeenCalled()
    expect(await screen.findByText('Virtual Device started')).toBeTruthy()
    expect(api.doctor.run).toHaveBeenCalledTimes(3)
  })

  test('with the SDK and VDA working, no devices does not block the app', async () => {
    await renderApp(noDevices)
    await screen.findByText('Doctor')
    expect(screen.queryByText('Set up OVD')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Devices' })).toBeTruthy()
  })
})

describe('Doctor tab', () => {
  test('Virtual Device Developer Mode off: Enable turns it on and checks again', async () => {
    const api = await renderApp(vvdDevmodeOff, doctorReport())
    fireEvent.click(nav('Doctor'))
    const rows = await screen.findByRole('list', { name: 'Checks' })
    expect(within(rows).getByText('Developer Mode is off on the Virtual Device')).toBeTruthy()
    fireEvent.click(within(rows).getByRole('button', { name: 'Enable' }))
    expect(api.vvd.enableDeveloperMode).toHaveBeenCalled()
    expect(await screen.findByText('Developer Mode on')).toBeTruthy()
    expect(api.doctor.run).toHaveBeenCalledTimes(2)
    expect(within(rows).queryByRole('button', { name: 'Enable' })).toBeNull()
  })

  test('Emulator gRPC off: Turn on starts the Virtual Device again and checks again', async () => {
    const api = await renderApp(grpcOff, doctorReport())
    fireEvent.click(nav('Doctor'))
    const rows = await screen.findByRole('list', { name: 'Checks' })
    expect(within(rows).getByText('Couldn’t enable')).toBeTruthy()
    fireEvent.click(within(rows).getByRole('button', { name: 'Turn on' }))
    expect(api.vvd.start).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Emulator gRPC on')).toBeTruthy()
    expect(screen.getAllByText(/ovd vvd start$/).length).toBeGreaterThan(0)
    expect(api.doctor.run).toHaveBeenCalledTimes(2)
    expect(await within(rows).findByText('On · :8554')).toBeTruthy()
    expect(within(rows).queryByRole('button', { name: 'Turn on' })).toBeNull()
  })

  test('Turn on that fails: an error toast with the hint and Retry, then checks again', async () => {
    const api = await renderWithVvd(
      {
        start: async () => ({
          ok: true,
          data: {
            running: true,
            status: 'online',
            device: { ...vvd, status: 'online' },
            grpc: {
              status: 'failed',
              error: {
                code: 'VVD_GRPC_FAILED',
                message: '~/.emulator_console_auth_token is missing or unreadable',
                hint: 'Restart the Virtual Device with ovd vvd stop, then ovd vvd start'
              }
            }
          }
        })
      },
      grpcOff
    )
    fireEvent.click(nav('Doctor'))
    const rows = await screen.findByRole('list', { name: 'Checks' })
    fireEvent.click(within(rows).getByRole('button', { name: 'Turn on' }))
    expect(
      await screen.findByText(
        'Emulator gRPC couldn’t be turned on. Restart the Virtual Device with ovd vvd stop, then ovd vvd start.'
      )
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(api.doctor.run).toHaveBeenCalledTimes(2)
    expect(await within(rows).findByRole('button', { name: 'Turn on' })).toBeTruthy()
  })

  test('Turn on with an IPC error toasts its hint', async () => {
    await renderWithVvd(
      {
        start: async () => ({
          ok: false,
          error: { code: 'VVD_START_FAILED', message: 'failed', hint: 'Run it in a terminal' }
        })
      },
      grpcOff
    )
    fireEvent.click(nav('Doctor'))
    const rows = await screen.findByRole('list', { name: 'Checks' })
    fireEvent.click(within(rows).getByRole('button', { name: 'Turn on' }))
    expect(
      await screen.findByText('Emulator gRPC couldn’t be turned on. Run it in a terminal.')
    ).toBeTruthy()
  })

  test('the sidebar opens Doctor with the summary and every row', async () => {
    await renderApp(noDevices)
    fireEvent.click(nav('Doctor'))
    expect(await screen.findByText('0 failing · 1 warning')).toBeTruthy()
    const rows = screen.getByRole('list', { name: 'Checks' })
    expect(within(rows).getAllByRole('listitem')).toHaveLength(7)
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
