import { describe, expect, test } from 'vitest'
import { parseVlcmTerminate } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

const recorded = (path: string) => fixture(`0.24/vlcm-terminate-app/${path}`)

describe('parseVlcmTerminate', () => {
  test.each([
    ['stopped.txt', 0, 'stopped'],
    ['force-stopped.txt', 0, 'stopped'],
    ['not-running.txt', 255, 'not-running']
  ] as const)('%s (exit %i) is %s', (file, exitCode, outcome) => {
    expect(parseVlcmTerminate({ stdout: recorded(file), stderr: '', exitCode })).toEqual({
      outcome
    })
  })

  test.each([
    [{ stdout: '', stderr: '', exitCode: 1 }, 'exit code 1'],
    [{ stdout: '', stderr: 'boom\n', exitCode: 1 }, 'boom'],
    // Stopping printed, but an exit code the tool never gave in the recordings.
    [
      { stdout: recorded('stopped.txt'), stderr: '', exitCode: 1 },
      'Stopping pkg: com.example.player'
    ]
  ])('anything else fails: %o', (result, reason) => {
    expect(parseVlcmTerminate(result)).toEqual({ outcome: 'failed', reason })
  })
})
