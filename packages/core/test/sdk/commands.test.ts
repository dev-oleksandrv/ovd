import { describe, expect, test } from 'vitest'
import { vdaCmd, vegaCmd, vegaDeviceCmd } from '../../src/sdk/commands.js'

describe('command builders', () => {
  test.each([
    [vegaCmd('/x/vega', ['--version']), ['--version'], 'vega --version'],
    [
      vegaDeviceCmd('/x/vega', 'info', [], 'VirtualDevice'),
      ['device', 'info', '--device', 'VirtualDevice'],
      'vega device info --device VirtualDevice'
    ],
    [vegaDeviceCmd('/x/vega', 'list', []), ['device', 'list'], 'vega device list'],
    [
      vdaCmd('/x/vega', ['get-serialno'], 'emulator-5554'),
      ['exec', 'vda', '-s', 'emulator-5554', 'get-serialno'],
      'vega exec vda -s emulator-5554 get-serialno'
    ],
    [
      vdaCmd('/x/vega', ['devices', '-l']),
      ['exec', 'vda', 'devices', '-l'],
      'vega exec vda devices -l'
    ]
  ])('%#: %s', (spec, args, display) => {
    expect([spec.file, spec.args, spec.display]).toEqual(['/x/vega', args, display])
  })

  test('passes timeout and signal through', () => {
    const signal = new AbortController().signal
    const spec = vegaCmd('/x/vega', ['--version'], { timeoutMs: 10_000, signal })
    expect(spec.timeoutMs).toBe(10_000)
    expect(spec.signal).toBe(signal)
  })
})
