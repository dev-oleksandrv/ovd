import { OvdError, type DoctorReport, type Ovd } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { cli } from '../support/runCli.js'

const host = { os: 'macOS', osVersion: '26.6', arch: 'arm64', node: '24.2.0' }

const healthy: DoctorReport = {
  host,
  checks: [
    {
      id: 'sdk',
      name: 'Vega SDK',
      status: 'ok',
      detail: '0.24.12112 · Vega CLI 1.4.5 · ~/vega/bin/vega',
      command: 'vega sdk config doctor --json'
    },
    {
      id: 'metro',
      name: 'Metro',
      status: 'info',
      detail: '8081, 8097 free on this computer · no target device',
      command: 'vega device is-port-forwarded'
    }
  ]
}

const noSdk: DoctorReport = {
  host,
  checks: [
    {
      id: 'sdk',
      name: 'Vega SDK',
      status: 'fail',
      detail: 'No Vega SDK found',
      hint: 'Install the Vega SDK',
      fix: 'install-sdk',
      command: 'vega sdk config doctor --json'
    },
    { id: 'vda', name: 'VDA', status: 'skipped', detail: 'Waiting for the Vega SDK' }
  ]
}

const withReport = (run: () => Promise<DoctorReport>): Partial<Ovd> => ({ doctor: { run } })

describe('ovd doctor', () => {
  test('--json prints the report and exits 0 when nothing fails', async () => {
    const { stdout, exitCode } = await cli(['doctor', '--json'], {
      ovd: withReport(async () => healthy)
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, ...healthy })
    expect(exitCode).toBe(0)
  })

  test('a failing check still prints the report and exits 1', async () => {
    const { stdout, exitCode } = await cli(['doctor', '--json'], {
      ovd: withReport(async () => noSdk)
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, ...noSdk })
    expect(exitCode).toBe(1)
  })

  test('human output marks a failing check and prints its fix', async () => {
    const { stdout, exitCode } = await cli(['doctor'], { ovd: withReport(async () => noSdk) })
    expect(stdout).toContain('macOS 26.6 · arm64 · Node 24.2.0')
    expect(stdout).toContain('✗ Vega SDK')
    expect(stdout).toContain('→ Install the Vega SDK')
    expect(exitCode).toBe(1)
  })

  test('a doctor that cannot run reports the error document', async () => {
    const { stdout, exitCode } = await cli(['doctor', '--json'], {
      ovd: withReport(() =>
        Promise.reject(new OvdError('UNEXPECTED_OUTPUT', 'Could not read x', 'Check the SDK'))
      )
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'UNEXPECTED_OUTPUT' } })
    expect(exitCode).toBe(1)
  })
})
