import { describe, expect, test } from 'vitest'
import { parseVdaPull } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

const recorded = (path: string) => fixture(`0.24/vda-pull/${path}`)

describe('parseVdaPull', () => {
  test('pulled.txt (exit 0) is ok', () => {
    expect(parseVdaPull({ stdout: recorded('pulled.txt'), stderr: '', exitCode: 0 })).toEqual({
      ok: true
    })
  })

  test('missing.txt (exit 1, on stdout) gives the vda error', () => {
    expect(parseVdaPull({ stdout: recorded('missing.txt'), stderr: '', exitCode: 1 })).toEqual({
      ok: false,
      message: "failed to stat remote object '/tmp/ovd-nope.png': No such file or directory"
    })
  })

  test.each([
    [{ stdout: '', stderr: '', exitCode: 1 }, 'exit code 1'],
    [{ stdout: '', stderr: 'boom\n', exitCode: 1 }, 'boom'],
    // Pulled, but an exit code the tool never gave in the recordings.
    [
      { stdout: recorded('pulled.txt'), stderr: '', exitCode: 1 },
      '/tmp/ovd-probe-synth.png: 1 file pulled, 0 skipped. 2.7 MB/s (5000 bytes in 0.002s)'
    ],
    [
      { stdout: '', stderr: fixture('0.24/vda-shell/stick-usb-not-found.stderr.txt'), exitCode: 1 },
      "vda: device 'G070000000000001' not found"
    ]
  ])('anything else fails: %o', (result, message) => {
    expect(parseVdaPull(result)).toEqual({ ok: false, message })
  })
})
