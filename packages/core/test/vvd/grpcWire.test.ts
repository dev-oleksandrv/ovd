import { describe, expect, test } from 'vitest'
import {
  decodeImage,
  decodeImageFrame,
  decodeVmRunState,
  encodeImageFormat,
  encodeKeyboardEvent,
  frame,
  unframe
} from '../../src/vvd/grpcWire.js'
import { fixture } from '../support/fixtures.js'
import { recordedStream } from '../support/fakeGrpcStream.js'

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

describe('decodeImage', () => {
  test('the recorded getScreenshot answer carries a 1920x1080 PNG in field 4', () => {
    const [message] = unframe(body('get-screenshot.json'))
    const image = decodeImage(message ?? new Uint8Array())
    expect(image.length).toBe(9780)
    expect(Buffer.from(image.subarray(0, 8)).toString('hex')).toBe('89504e470d0a1a0a')
    expect(Buffer.from(image.subarray(16, 24)).toString('hex')).toBe('0000078000000438')
  })

  test.each([
    // Field 4 alone.
    ['2203010203', '010203'],
    // Varint (0), 64-bit (1), length-delimited (2) and 32-bit (5) fields are skipped.
    ['0801' + '110102030405060708' + '0a0100' + '1d01020304' + '220109' + '3005', '09']
  ])('%s', (hex, image) => {
    expect(Buffer.from(decodeImage(new Uint8Array(Buffer.from(hex, 'hex')))).toString('hex')).toBe(
      image
    )
  })

  test.each([
    ['', 'no image'],
    ['0801', 'no image'],
    ['2205', 'Truncated'],
    ['1b', 'wire type 3']
  ])('rejects %j', (hex, message) => {
    expect(() => decodeImage(new Uint8Array(Buffer.from(hex, 'hex')))).toThrow(message)
  })
})

describe('encodeImageFormat', () => {
  test.each([
    [{ format: 'rgba8888', width: 960, height: 540 }, '080118c007209c04'],
    // The recorded request.
    [{ format: 'rgba8888', width: 64, height: 36 }, '080118402024'],
    // PNG (0) at the display's size: every field at its default.
    [{ format: 'png', width: 0, height: 0 }, ''],
    [{ format: 'rgb888', width: 640, height: 360 }, '080218800520e802']
  ] as const)('%j', (format, hex) => {
    expect(Buffer.from(encodeImageFormat(format)).toString('hex')).toBe(hex)
  })
})

describe('decodeImageFrame', () => {
  test('the recorded stream frames: RGBA8888 64x36, seq 0, 1, 2', () => {
    const frames = recordedStream().messages.map(decodeImageFrame)
    expect(frames.map((f) => [f.width, f.height, f.seq, f.pixels.length])).toEqual([
      [64, 36, 0, 9216],
      [64, 36, 1, 9216],
      [64, 36, 2, 9216]
    ])
    expect(frames.every((f) => f.timestampUs > 1_700_000_000_000_000)).toBe(true)
    // The pixels are the bytes of field 4, alpha 0xff.
    expect(frames[0]?.pixels[3]).toBe(0xff)
  })

  test.each([
    // A PNG frame (format 0).
    ['0a0418402024220100'],
    // RGBA8888 1x1 with 3 bytes.
    ['0a060801180120012203000000'],
    // No pixels.
    ['0a06080118012001'],
    // Truncated.
    ['0a06']
  ])('rejects %s', (hex) => {
    expect(() => decodeImageFrame(new Uint8Array(Buffer.from(hex, 'hex')))).toThrow()
  })

  test('a 1x1 RGBA8888 frame', () => {
    const frame = decodeImageFrame(
      new Uint8Array(Buffer.from('0a060801180120012204010203042805', 'hex'))
    )
    expect(frame).toEqual({
      width: 1,
      height: 1,
      seq: 5,
      timestampUs: 0,
      pixels: Uint8Array.from([1, 2, 3, 4])
    })
  })
})
