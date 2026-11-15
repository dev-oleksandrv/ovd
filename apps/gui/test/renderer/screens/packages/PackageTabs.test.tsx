import type { PackageInfo, PackageValidation } from '@ovd/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { IpcResult, OvdApi } from '../../../../src/preload/api'
import { DevicesProvider } from '../../../../src/renderer/src/devices/DevicesProvider'
import { FeedbackProvider } from '../../../../src/renderer/src/feedback/FeedbackProvider'
import { ToastViewport } from '../../../../src/renderer/src/feedback/ToastViewport'
import { StatusBar } from '../../../../src/renderer/src/frame/StatusBar'
import { PackagesScreen } from '../../../../src/renderer/src/screens/packages/PackagesScreen'
import { ready, stubOvd } from '../../support/ovdStub'
import { armv7Build, armv7Info, project } from './sample'
import { brokenValidation, manifestFile, packageFiles, validValidation } from './tabsSample'

const fail = <T,>(message: string): IpcResult<T> => ({
  ok: false,
  error: { code: 'COMMAND_FAILED', message, hint: 'Check the Vega SDK install with ovd doctor' }
})

function stub(opts: Partial<OvdApi['packages']> = {}): OvdApi {
  return stubOvd({
    list: async () => ready([], null),
    devices: [],
    packages: {
      builds: async () => ({ ok: true, data: [armv7Build] }),
      info: async (): Promise<IpcResult<PackageInfo>> => ({ ok: true, data: armv7Info }),
      manifest: async () => ({ ok: true, data: manifestFile }),
      files: async () => ({ ok: true, data: packageFiles }),
      validate: async () => ({ ok: true, data: brokenValidation }),
      ...opts
    }
  }).api
}

function renderScreen(): void {
  render(
    <FeedbackProvider>
      <DevicesProvider>
        <PackagesScreen
          projectPath={project.path}
          onOpenFolder={() => {}}
          onSwitchTarget={() => {}}
        />
      </DevicesProvider>
      <StatusBar />
      <ToastViewport />
    </FeedbackProvider>
  )
}

async function openTab(name: string): Promise<void> {
  await screen.findByRole('heading', { name: 'Sample Player 1.4.2 (142)' })
  await act(async () => fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) })))
}

const echo = (cli: string) => screen.getAllByText(`$ ${cli}`).length

describe('Packages → Manifest, Files, Validate', () => {
  test('Validate: the table, the badge, and the echo', async () => {
    const api = stub()
    renderScreen()
    await openTab('Validate')
    expect(await screen.findByText('3 errors · 5 notes')).toBeTruthy()
    const tab = screen.getByRole('tab', { name: /^Validate/ })
    expect(tab.textContent).toBe('Validate3')
    expect(screen.getAllByRole('row')).toHaveLength(9)
    expect(
      screen.getByText(
        "[components.interactive.launch-type] 'sometimes' launch type is not supported for 'interactive' component."
      )
    ).toBeTruthy()
    expect(echo(`ovd pkg validate ${armv7Info.displayPath}`)).toBeGreaterThan(0)
    expect(api.packages.validate).toHaveBeenCalledTimes(1)
    expect(api.packages.validate).toHaveBeenCalledWith(armv7Info.path)
  })

  test('a location opens Manifest at that line; an unlocated issue isn’t a button', async () => {
    stub()
    renderScreen()
    await openTab('Validate')
    const location = await screen.findByRole('button', { name: 'manifest.toml:33:15' })
    expect(screen.queryByRole('button', { name: '—' })).toBeNull()
    await act(async () => fireEvent.click(location))
    expect(screen.getByRole('tab', { name: 'Manifest' }).getAttribute('aria-selected')).toBe('true')
    const line = await screen.findByRole('listitem', { name: 'Line 33' })
    expect(line.getAttribute('aria-current')).toBe('true')
    expect(within(line).getByText('launch-type = "sometimes"')).toBeTruthy()
    expect(within(line).getByText('error')).toBeTruthy()
    expect(echo(`ovd pkg manifest ${armv7Info.displayPath}`)).toBeGreaterThan(0)
  })

  test('Manifest: notes under their lines, unlocated notes on top, one validation', async () => {
    const api = stub()
    renderScreen()
    await openTab('Manifest')
    const line7 = await screen.findByRole('listitem', { name: 'Line 7' })
    expect(
      within(line7).getByText(
        '[package.build-number] build-number must be greater than 0, found: 0'
      )
    ).toBeTruthy()
    const top = screen.getByRole('list', { name: 'Notes without a line' })
    expect(
      within(top).getByText('[os.version] contains value(s) not in the OS Version registry.')
    ).toBeTruthy()
    await openTab('Validate')
    await openTab('Files')
    expect(api.packages.validate).toHaveBeenCalledTimes(1)
    expect(api.packages.manifest).toHaveBeenCalledTimes(1)
  })

  test('Files: the tree, with the error badge on manifest.toml, which opens Manifest', async () => {
    stub()
    renderScreen()
    await openTab('Files')
    const tree = await screen.findByRole('list', { name: 'Files' })
    expect(within(tree).getByText('keplerscript-app-config.json')).toBeTruthy()
    const manifest = await within(tree).findByRole('button', { name: /manifest\.toml.*3 errors/ })
    expect(echo(`ovd pkg files ${armv7Info.displayPath}`)).toBeGreaterThan(0)
    await act(async () => fireEvent.click(manifest))
    expect(screen.getByRole('tab', { name: 'Manifest' }).getAttribute('aria-selected')).toBe('true')
  })

  test('a valid package: no problems, no badge; Validate again notifies with the CLI', async () => {
    const validate = vi.fn(async (): Promise<IpcResult<PackageValidation>> => ({
      ok: true,
      data: validValidation
    }))
    stub({ validate })
    renderScreen()
    await openTab('Validate')
    expect(await screen.findByText('No problems found')).toBeTruthy()
    expect(screen.getByRole('tab', { name: /^Validate/ }).textContent).toBe('Validate')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Validate again' })))
    expect(await screen.findByText('player_armv7.vpkg is valid')).toBeTruthy()
    expect(validate).toHaveBeenCalledTimes(2)
  })

  test('errors show the message, the hint and Retry', async () => {
    let calls = 0
    stub({
      validate: async () =>
        ++calls === 1 ? fail('vpt validate failed') : { ok: true, data: validValidation },
      files: async () => fail('vpt show-contents failed')
    })
    renderScreen()
    await openTab('Validate')
    expect(await screen.findByText('vpt validate failed')).toBeTruthy()
    expect(screen.getByText('Check the Vega SDK install with ovd doctor')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })))
    expect(await screen.findByText('No problems found')).toBeTruthy()
    await openTab('Files')
    expect(await screen.findByText('vpt show-contents failed')).toBeTruthy()
  })

  test('loading states while vpt reads', async () => {
    stub({ manifest: () => new Promise(() => {}), validate: () => new Promise(() => {}) })
    renderScreen()
    await openTab('Manifest')
    expect(screen.getByText('Reading manifest.toml from player_armv7.vpkg…')).toBeTruthy()
    await openTab('Validate')
    expect(screen.getByText('Validating player_armv7.vpkg…')).toBeTruthy()
  })
})
