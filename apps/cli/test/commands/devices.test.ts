import { describe, expect, test } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stick, stubOvd, vvd } from '../support/sample.js'

describe('ovd devices', () => {
  test('--json lists devices and the target', async () => {
    const ovd = stubOvd({ list: async () => ({ devices: [stick, vvd], target: stick.id }) })
    const { stdout, exitCode } = await cli(['devices', '--json'], { ovd })
    expect(JSON.parse(stdout)).toEqual({ ok: true, devices: [stick, vvd], target: stick.id })
    expect(exitCode).toBe(0)
  })

  test('human output marks the target', async () => {
    const ovd = stubOvd({ list: async () => ({ devices: [stick, vvd], target: stick.id }) })
    const { stdout } = await cli(['devices'], { ovd })
    expect(stdout).toContain('* Fire TV stick')
    expect(stdout).toContain('USB · armv7 · OS 2.0')
  })

  test('without a stick, stderr explains Developer Mode', async () => {
    const ovd = stubOvd({ list: async () => ({ devices: [vvd], target: null }) })
    const { stderr } = await cli(['devices'], { ovd })
    expect(stderr).toContain('Developer Mode')
  })

  test('VDA unavailable exits 3 with the error document', async () => {
    const { stdout, exitCode } = await cli(['devices', '--json'], {
      ovd: stubOvd({ list: fail('VDA_UNAVAILABLE') })
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code: 'VDA_UNAVAILABLE' } })
    expect(exitCode).toBe(3)
  })
})
