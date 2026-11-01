import type { PackageInfo } from '@ovd/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { IpcResult, OvdApi } from '../../../../src/preload/api'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ToastViewport } from '../../../../src/renderer/src/feedback/ToastViewport'
import { StatusBar } from '../../../../src/renderer/src/frame/StatusBar'
import { PackagesScreen } from '../../../../src/renderer/src/screens/packages/PackagesScreen'
import { ready, stubOvd } from '../../support/ovdStub'
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

function stub(
  opts: { builds?: OvdApi['packages']['builds']; info?: OvdApi['packages']['info'] } = {}
): OvdApi {
  return stubOvd({
    list: async () => ready([]),
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

function renderScreen(projectPath: string | null = project.path): void {
  render(
    <FeedbackProvider>
      <PackagesScreen projectPath={projectPath} onOpenFolder={() => {}} />
      <StatusBar />
      <ToastViewport />
    </FeedbackProvider>
  )
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

  test('Install on target waits for a later version and says so', async () => {
    stub()
    renderScreen()
    const install = await screen.findByRole('button', { name: 'Install on target' })
    expect((install as HTMLButtonElement).disabled).toBe(true)
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
