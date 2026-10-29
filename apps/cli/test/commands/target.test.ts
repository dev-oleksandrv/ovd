import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { stick, stubOvd, vvd } from '../support/sample.js'

describe('ovd target', () => {
  test('--json prints the target and where it came from', async () => {
    const ovd = stubOvd({ currentTarget: async () => ({ device: stick, source: 'remembered' }) })
    expect(JSON.parse((await cli(['target', '--json'], { ovd })).stdout)).toEqual({
      ok: true,
      target: stick,
      source: 'remembered'
    })
  })

  test('no target is not an error', async () => {
    const ovd = stubOvd({ currentTarget: async () => null })
    const { stdout, stderr, exitCode } = await cli(['target', '--json'], { ovd })
    expect(JSON.parse(stdout)).toEqual({ ok: true, target: null, source: null })
    expect(exitCode).toBe(0)
    const human = await cli(['target'], { ovd })
    expect(human.stdout).toBe('No target.\n')
    expect(human.stderr).toContain('ovd target set <id>')
    expect(stderr).toBe('')
  })

  test('--device is passed through as an explicit override', async () => {
    const currentTarget = vi.fn(async () => ({ device: vvd, source: 'flag' as const }))
    await cli(['target', '--device', 'emulator-5554', '--json'], {
      ovd: stubOvd({ currentTarget })
    })
    expect(currentTarget).toHaveBeenCalledWith('emulator-5554')
  })

  test('human output names the target', async () => {
    const ovd = stubOvd({ currentTarget: async () => ({ device: stick, source: 'remembered' }) })
    expect((await cli(['target'], { ovd })).stdout).toBe(
      'Target: Fire TV stick (G070000000000001 · armv7)\n'
    )
  })
})

describe('ovd target set', () => {
  test('--json prints the new target', async () => {
    const setTarget = vi.fn(async () => ({ ...vvd, isTarget: true }))
    const { stdout } = await cli(['target', 'set', 'VirtualDevice', '--json'], {
      ovd: stubOvd({ setTarget })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, target: { ...vvd, isTarget: true } })
    expect(setTarget).toHaveBeenCalledWith('VirtualDevice')
  })

  test('human output for a stopped device shows its status', async () => {
    const ovd = stubOvd({ setTarget: async () => vvd })
    expect((await cli(['target', 'set', 'VirtualDevice'], { ovd })).stdout).toBe(
      'Target: Vega Virtual Device (VirtualDevice · stopped)\n'
    )
  })
})
