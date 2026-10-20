import { describe, expect, test } from 'vitest'
import { discoverSdk, OvdError } from '../../src/index.js'
import type { CommandSpec, Runner, RunResult } from '../../src/sdk/runner.js'
import { fixture } from '../support/fixtures.js'

const MANAGER = fixture('0.24/vega-version/manager.txt')
const BUNDLED = fixture('0.24/vega-version/bundled.txt')

type Reply = Partial<RunResult> | OvdError

// Every candidate prints the same `vega --version` display, so this fake is keyed by file path.
function runnerByFile(replies: Record<string, Reply>): Runner & { files: string[] } {
  const files: string[] = []
  return {
    files,
    async run(spec: CommandSpec) {
      files.push(spec.file)
      const reply = replies[spec.file]
      if (reply === undefined) throw new Error(`unexpected ${spec.file}`)
      if (reply instanceof OvdError) throw reply
      return { stdout: '', stderr: '', exitCode: 0, durationMs: 0, command: spec.display, ...reply }
    }
  }
}

const executable = (paths: string[]) => async (path: string) => paths.includes(path)

describe('discoverSdk', () => {
  test('OVD_VEGA is used exclusively when set', async () => {
    const runner = runnerByFile({ '/opt/vega': { stdout: MANAGER } })
    const sdk = await discoverSdk({
      runner,
      env: { OVD_VEGA: '/opt/vega', PATH: '/a' },
      homedir: '/h',
      isExecutable: executable(['/opt/vega', '/a/vega', '/h/vega/bin/vega'])
    })
    expect(sdk).toEqual({
      vegaPath: '/opt/vega',
      cli: 'manager',
      sdkVersion: '0.24.12112',
      cliVersion: '1.4.5'
    })
    expect(runner.files).toEqual(['/opt/vega'])
  })

  test('prefers the SDK Manager over a bundled vega that comes first on PATH', async () => {
    const runner = runnerByFile({
      '/a/vega': { stdout: BUNDLED },
      '/h/vega/bin/vega': { stdout: MANAGER }
    })
    const sdk = await discoverSdk({
      runner,
      env: { PATH: '/a:/b' },
      homedir: '/h',
      isExecutable: executable(['/a/vega', '/h/vega/bin/vega'])
    })
    expect(sdk).toEqual({
      vegaPath: '/h/vega/bin/vega',
      cli: 'manager',
      sdkVersion: '0.24.12112',
      cliVersion: '1.4.5'
    })
  })

  test('returns a bundled-only vega when no SDK Manager exists', async () => {
    const sdk = await discoverSdk({
      runner: runnerByFile({ '/a/vega': { stdout: BUNDLED } }),
      env: { PATH: '/a' },
      homedir: '/h',
      isExecutable: executable(['/a/vega'])
    })
    expect(sdk).toEqual({ vegaPath: '/a/vega', cli: 'bundled', sdkVersion: '0.24.12112' })
  })

  test('probes a duplicated PATH entry once', async () => {
    const runner = runnerByFile({ '/a/vega': { stdout: BUNDLED } })
    await discoverSdk({
      runner,
      env: { PATH: '/a:/a' },
      homedir: '/h',
      isExecutable: executable(['/a/vega'])
    })
    expect(runner.files).toEqual(['/a/vega'])
  })

  test('skips candidates that fail to run or print something else', async () => {
    const runner = runnerByFile({
      '/a/vega': new OvdError('COMMAND_FAILED', 'm', 'h'),
      '/b/vega': { exitCode: 1, stdout: '' },
      '/c/vega': { stdout: 'Vega SDK CLI\n\nUsage: vega' },
      '/h/vega/bin/vega': { stdout: MANAGER }
    })
    const sdk = await discoverSdk({
      runner,
      env: { PATH: '/a:/b:/c' },
      homedir: '/h',
      isExecutable: executable(['/a/vega', '/b/vega', '/c/vega', '/h/vega/bin/vega'])
    })
    expect(sdk.vegaPath).toBe('/h/vega/bin/vega')
  })

  test('nothing usable rejects with SDK_NOT_FOUND listing the candidates', async () => {
    const run = discoverSdk({
      runner: runnerByFile({}),
      env: { PATH: '/a' },
      homedir: '/h',
      isExecutable: executable([])
    })
    await expect(run).rejects.toMatchObject({
      code: 'SDK_NOT_FOUND',
      details: { tried: ['/a/vega', '/h/vega/bin/vega'] }
    })
  })
})
