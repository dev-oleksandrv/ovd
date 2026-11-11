import { describe, expect, test } from 'vitest'
import { decodeVmRunState, encodeKeyboardEvent, frame, unframe } from '../../src/vvd/grpcWire.js'
import { fixture } from '../support/fixtures.js'

const body = (name: string) => {
  const recorded = JSON.parse(fixture(`0.24/emulator-grpc/${name}`)) as { body: string }
  return new Uint8Array(Buffer.from(recorded.body, 'hex'))
}

describe('frame and unframe', () => {
  test.each([
    [new Uint8Array(), '0000000000'],
    [Uint8Array.from([0x08, 0x01]), '00000000020801']
  ])('%#', (message, hex) => {
    expect(Buffer.from(frame(message)).toString('hex')).toBe(hex)
    expect(unframe(frame(message))).toEqual([message])
  })

  test.each([
    ['get-vm-state-running.json', [Uint8Array.from([0x08, 0x01])]],
    ['send-key.json', [new Uint8Array()]],
    ['get-vm-state-unauthenticated.json', []]
  ])('recorded body %s', (name, messages) => {
    expect(unframe(body(name))).toEqual(messages)
  })

  test.each([
    ['000000', 'Truncated'],
    ['0000000005080', 'Truncated'],
    ['00000000050801', 'Truncated'],
    ['01000000020801', 'Compressed']
  ])('rejects %s', (hex, message) => {
    expect(() => unframe(new Uint8Array(Buffer.from(hex, 'hex')))).toThrow(message)
  })
})

describe('encodeKeyboardEvent', () => {
  test.each([
    // codeType Evdev (1); keydown (0) is the default, so it's left out.
    [158, 'down', '0801189e01'],
    [158, 'up', '08011001189e01'],
    [28, 'down', '0801181c'],
    [0, 'up', '08011001']
  ] as const)('key %i %s', (code, type, hex) => {
    expect(Buffer.from(encodeKeyboardEvent(code, type)).toString('hex')).toBe(hex)
  })

  test('a negative key code is refused', () => {
    expect(() => encodeKeyboardEvent(-1, 'down')).toThrow('Not a varint')
  })
})

describe('decodeVmRunState', () => {
  test('the recorded getVmState answer is RUNNING', () => {
    const [message] = unframe(body('get-vm-state-running.json'))
    expect(decodeVmRunState(message ?? new Uint8Array())).toEqual({ state: 1, running: true })
  })

  test.each([
    ['', { state: 0, running: false }],
    ['0803', { state: 3, running: false }],
    // An unknown varint field is skipped.
    ['10050801', { state: 1, running: true }]
  ])('%j', (hex, expected) => {
    expect(decodeVmRunState(new Uint8Array(Buffer.from(hex, 'hex')))).toEqual(expected)
  })

  test.each(['08', '0a0101'])('rejects %j', (hex) => {
    expect(() => decodeVmRunState(new Uint8Array(Buffer.from(hex, 'hex')))).toThrow()
  })
})
