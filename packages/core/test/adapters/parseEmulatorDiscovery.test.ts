import { describe, expect, test } from 'vitest'
import { parseEmulatorDiscovery } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

const recorded = fixture('0.24/emulator-discovery/virtual-device.ini')

describe('parseEmulatorDiscovery', () => {
  test('reads the ports and the token', () => {
    expect(parseEmulatorDiscovery(recorded)).toEqual({
      consolePort: 5554,
      grpcPort: 8554,
      token: Buffer.from('ovd-fake-grpc-token-'.padEnd(66, '0')).toString('base64')
    })
  })

  test('CRLF line ends', () => {
    expect(parseEmulatorDiscovery(recorded.replaceAll('\n', '\r\n')).grpcPort).toBe(8554)
  })

  test.each([
    ['', 'an empty file'],
    [recorded.replace(/^grpc\.token=.*$/m, ''), 'no token'],
    [recorded.replace(/^grpc\.port=.*$/m, 'grpc.port=nope'), 'a bad port'],
    [recorded.replace(/^port\.serial=.*$/m, ''), 'no console port']
  ])('rejects %#: %s, without its content in the error', (text) => {
    let thrown: unknown
    try {
      parseEmulatorDiscovery(text)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ code: 'UNEXPECTED_OUTPUT' })
    expect(JSON.stringify(thrown)).not.toContain('b3Zk')
    expect((thrown as { details?: unknown }).details).toBeUndefined()
  })
})
