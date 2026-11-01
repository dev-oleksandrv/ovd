import type { ArchCheck, Device, InstallResult, PackageInfo } from '@ovd/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { IpcResult, OvdApi } from '../../../../src/preload/api'
import { DevicesProvider } from '../../../../src/renderer/src/devices/DevicesProvider'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ToastViewport } from '../../../../src/renderer/src/feedback/ToastViewport'
import { StatusBar } from '../../../../src/renderer/src/frame/StatusBar'
import { PackagesScreen } from '../../../../src/renderer/src/screens/packages/PackagesScreen'
import { ready, stubOvd } from '../../support/ovdStub'
import { stick } from '../devices/sample'
import { aarch64Build, armv7Build, armv7Info, droppedInfo, project } from './sample'

const infos: Record<string, PackageInfo> = {
  [armv7Info.path]: armv7Info,
  [aarch64Build.path]: {
    ...armv7Info,
    ...aarch64Build,
    architecture: 'aarch64',
    buildType: 'debug'
  },
  [droppedInfo.path]: droppedInfo
}

const stickTarget = { id: stick.id, name: 'Fire TV Stick 4K Select', architecture: 'armv7' }

// What core's guard answers for a recorded package on the armv7 stick.
function guard(path: string): ArchCheck {
  const architecture = infos[path]?.architecture ?? 'unknown'
  const allowed = architecture === 'armv7' || architecture === 'any'
  return {
    allowed,
    verdict: allowed ? 'match' : 'mismatch',
    package: { path, architecture },
    target: stickTarget,
    ...(allowed ? {} : { fix: armv7Build })
  }
}

function stub(
  opts: {
    builds?: OvdApi['packages']['builds']
    info?: OvdApi['packages']['info']
    devices?: Device[]
    check?: OvdApi['install']['check']
    install?: OvdApi['install']['install']
  } = {}
): OvdApi {
  const devices = opts.devices ?? []
  return stubOvd({
    list: async () => ready(devices, devices[0]?.id ?? null),
    devices,
    install: {
      check: opts.check ?? (async (path: string) => ({ ok: true, data: guard(path) })),
      ...(opts.install ? { install: opts.install } : {})
    },
    packages: {
      builds: opts.builds ?? (async () => ({ ok: true, data: [armv7Build, aarch64Build] })),
      info:
        opts.info ??
        (async (path: string): Promise<IpcResult<PackageInfo>> => {
          const info = infos[path]
          return info
            ? { ok: true, data: info }
            : {
                ok: false,
                error: { code: 'NOT_A_VPKG', message: 'Not a .vpkg file: x', hint: 'Open a .vpkg' }
              }
        }),
      pick: async () => ({ ok: true, data: droppedInfo.path })
    }
  }).api
}

function renderScreen(
  projectPath: string | null = project.path,
  onSwitchTarget: () => void = () => {}
): void {
  render(
    <FeedbackProvider>
      <DevicesProvider>
        <PackagesScreen
          projectPath={projectPath}
          onOpenFolder={() => {}}
          onSwitchTarget={onSwitchTarget}
        />
      </DevicesProvider>
      <StatusBar />
      <ToastViewport />
    </FeedbackProvider>
  )
}

const installed: InstallResult = {
  installed: true,
  package: {
    path: armv7Info.path,
    displayPath: armv7Info.displayPath,
    file: armv7Info.file,
    id: armv7Info.id,
    title: armv7Info.title,
    version: armv7Info.version,
    buildNumber: armv7Info.buildNumber,
    architecture: 'armv7'
  },
  target: stickTarget,
  forced: false
}

describe('Packages screen', () => {
  test('lists the project’s builds and shows the newest one’s overview', async () => {
    const api = stub()
    renderScreen()
    const list = await screen.findByRole('list', { name: 'Recent builds' })
    expect(within(list).getByText('player_armv7.vpkg')).toBeTruthy()
    expect(within(list).getByText('player_aarch64.vpkg')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Sample Player 1.4.2 (142)' })).toBeTruthy()
    expect(screen.getByText('~/dev/player/build/armv7-release/player_armv7.vpkg')).toBeTruthy()
    expect(screen.getByText('1.5 MB · 2.8 MB unpacked')).toBeTruthy()
    expect(screen.getByText('vpt info --json')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Manifest' })).toBeNull()
    expect(api.packages.info).toHaveBeenCalledTimes(1)
  })

  test('without a target, Install on target is disabled and says why', async () => {
    stub()
    renderScreen()
    const install = await screen.findByRole('button', { name: 'Install on target' })
    expect((install as HTMLButtonElement).disabled).toBe(true)
    expect(install.getAttribute('title')).toBe('No target device: pick one in the title bar')
  })

  test('an offline target disables Install on target', async () => {
    stub({ devices: [{ ...stick, status: 'offline' }] })
    renderScreen()
    const install = await screen.findByRole('button', { name: 'Install on target' })
    await vi.waitFor(() => expect(install.getAttribute('title')).toBe('Fire TV stick is offline'))
  })

  test('installs a matching package on the target with its CLI', async () => {
    const install = vi.fn(async () => ({ ok: true as const, data: installed }))
    stub({ devices: [stick], install })
    renderScreen()
    await screen.findByRole('heading', { name: 'Sample Player 1.4.2 (142)' })
    const button = screen.getByRole('button', { name: 'Install on target' })
    await vi.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    await act(async () => fireEvent.click(button))
    expect(install).toHaveBeenCalledWith(armv7Info.path, stick.id)
    expect(await screen.findByText('Installed on Fire TV Stick 4K Select')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    // The status bar and both toasts carry it.
    expect(
      screen.getAllByText(
        '$ ovd install ~/dev/player/build/armv7-release/player_armv7.vpkg --device G070000000000001'
      ).length
    ).toBeGreaterThan(0)
  })

  test('a mismatch blocks the install and offers the matching build', async () => {
    const install = vi.fn()
    stub({ devices: [stick], install })
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: /player_aarch64\.vpkg/ }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'blockArchitecture mismatch: package is aarch64, Fire TV Stick 4K Select is armv7. Install is blocked.Use player_armv7.vpkg'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Install on target' }))
    expect(await screen.findByText('Install blocked: architecture mismatch')).toBeTruthy()
    expect(install).not.toHaveBeenCalled()

    fireEvent.click(within(alert).getByRole('button', { name: 'Use player_armv7.vpkg' }))
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByText('Release', { selector: 'dd' })).toBeTruthy()
  })

  test('without a matching build, the fix opens the target picker', async () => {
    const onSwitchTarget = vi.fn()
    stub({
      devices: [stick],
      check: async (path: string) => {
        const check = guard(path)
        delete check.fix
        return { ok: true, data: check }
      }
    })
    renderScreen(project.path, onSwitchTarget)
    fireEvent.click(await screen.findByRole('button', { name: /player_aarch64\.vpkg/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Switch target' }))
    expect(onSwitchTarget).toHaveBeenCalledOnce()
  })

  test('a failed install shows core’s message', async () => {
    stub({
      devices: [stick],
      install: async () => ({
        ok: false,
        error: { code: 'INSTALL_FAILED', message: 'Install failed: nope', hint: 'Retry' }
      })
    })
    renderScreen()
    await screen.findByRole('heading', { name: 'Sample Player 1.4.2 (142)' })
    const button = screen.getByRole('button', { name: 'Install on target' })
    await vi.waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    await act(async () => fireEvent.click(button))
    expect(await screen.findByText('Install failed: nope')).toBeTruthy()
  })

  test('selecting a build reads it and echoes ovd pkg info', async () => {
    stub()
    renderScreen()
    fireEvent.click(await screen.findByRole('button', { name: /player_aarch64\.vpkg/ }))
    expect(await screen.findByText('Debug', { selector: 'dd' })).toBeTruthy()
    expect(
      screen.getByText('$ ovd pkg info ~/dev/player/build/aarch64-debug/player_aarch64.vpkg')
    ).toBeTruthy()
  })

  test('a dropped .vpkg is inspected, listed and toasted with its CLI', async () => {
    const api = stub()
    renderScreen()
    await screen.findByRole('heading', { name: 'Sample Player 1.4.2 (142)' })
    const file = new File(['vpkg'], 'hellovega_armv7.vpkg')
    await act(async () => {
      fireEvent.drop(screen.getByRole('button', { name: /Drop a \.vpkg here/ }), {
        dataTransfer: { files: [file], types: ['Files'] }
      })
    })
    expect(api.packages.info).toHaveBeenCalledWith('/home/dev/Downloads/hellovega_armv7.vpkg')
    expect(await screen.findByRole('heading', { name: 'Hello Vega 0.1.0 (0)' })).toBeTruthy()
    expect(screen.getByText('any (no native code)')).toBeTruthy()
    expect(screen.getByText('Inspected hellovega_armv7.vpkg')).toBeTruthy()
    const list = screen.getByRole('list', { name: 'Recent builds' })
    expect(within(list).getAllByRole('button')[0]?.textContent).toContain('hellovega_armv7.vpkg')
  })

  test('a file vpt can’t read shows the error as a toast', async () => {
    stub({ builds: async () => ({ ok: true, data: [] }) })
    renderScreen(null)
    await screen.findByText('No packages yet')
    await act(async () => {
      fireEvent.drop(screen.getByRole('button', { name: /Drop a \.vpkg here/ }), {
        dataTransfer: { files: [new File(['x'], 'notes.vpkg')], types: ['Files'] }
      })
    })
    expect(await screen.findByText('Not a .vpkg file: x')).toBeTruthy()
  })

  test('with nothing open, the empty state offers a .vpkg or a project folder', async () => {
    stub({ builds: async () => ({ ok: true, data: [] }) })
    renderScreen(null)
    expect(await screen.findByText('No packages yet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open a .vpkg…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open a project folder…' })).toBeTruthy()
  })

  test('a build list error shows its hint', async () => {
    stub({
      builds: async () => ({
        ok: false,
        error: { code: 'SDK_NOT_FOUND', message: 'No Vega SDK', hint: 'Install the Vega SDK' }
      })
    })
    renderScreen()
    expect(await screen.findByText('No Vega SDK')).toBeTruthy()
    expect(screen.getByText('Install the Vega SDK')).toBeTruthy()
  })
})
