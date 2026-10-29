import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stick, stubOvd } from '../support/sample.js'

describe('ovd device info', () => {
  test('--json prints the device', async () => {
    const get = vi.fn(async () => stick)
    const { stdout, exitCode } = await cli(['device', 'info', stick.id, '--json'], {
      ovd: stubOvd({ get })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, device: stick })
    expect(get).toHaveBeenCalledWith(stick.id)
    expect(exitCode).toBe(0)
  })

  test('an unknown device exits 4', async () => {
    const { stdout, exitCode } = await cli(['device', 'info', 'NOPE', '--json'], {
      ovd: stubOvd({ get: fail('DEVICE_NOT_FOUND') })
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'DEVICE_NOT_FOUND' } })
    expect(exitCode).toBe(4)
  })

  test('human output lists the info rows', async () => {
    const { stdout } = await cli(['device', 'info', stick.id], {
      ovd: stubOvd({ get: async () => stick })
    })
    expect(stdout).toMatch(/Architecture\s+armv7/)
    expect(stdout).toMatch(/Serial\s+G070000000000001/)
  })
})

describe('ovd device rename', () => {
  test('--json prints the renamed device', async () => {
    const renamed = { ...stick, name: 'Living room stick' }
    const rename = vi.fn(async () => renamed)
    const { stdout } = await cli(['device', 'rename', stick.id, 'Living room stick', '--json'], {
      ovd: stubOvd({ rename })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, device: renamed })
    expect(rename).toHaveBeenCalledWith(stick.id, 'Living room stick')
  })

  test('an invalid name exits 2', async () => {
    const { stdout, exitCode } = await cli(['device', 'rename', stick.id, '', '--json'], {
      ovd: stubOvd({ rename: fail('INVALID_NAME') })
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_NAME' } })
    expect(exitCode).toBe(2)
  })
})
