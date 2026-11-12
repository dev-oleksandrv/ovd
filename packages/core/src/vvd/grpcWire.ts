// The few bytes of gRPC and protobuf the Virtual Device backend needs, so core gets by on
// `node:http2` without a gRPC library. Pure functions; nothing here touches the network.

// gRPC length-prefixed message: a compressed flag (always 0 here), a 4-byte big-endian length,
// then the message.
export function frame(message: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + message.length)
  new DataView(out.buffer).setUint32(1, message.length)
  out.set(message, 5)
  return out
}

// The messages of a gRPC response body, in order. Throws on a truncated or compressed frame.
export function unframe(body: Uint8Array): Uint8Array[] {
  const messages: Uint8Array[] = []
  let at = 0
  while (at < body.length) {
    if (body.length - at < 5) throw new Error('Truncated gRPC frame')
    if (body[at] !== 0) throw new Error('Compressed gRPC frames are not supported')
    const length = new DataView(body.buffer, body.byteOffset + at + 1, 4).getUint32(0)
    const start = at + 5
    if (start + length > body.length) throw new Error('Truncated gRPC frame')
    messages.push(body.subarray(start, start + length))
    at = start + length
  }
  return messages
}

function varint(value: number): number[] {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Not a varint: ${value}`)
  const bytes: number[] = []
  let v = value
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80)
    v = Math.floor(v / 128)
  }
  bytes.push(v)
  return bytes
}

// A varint field (wire type 0); proto3 leaves out fields at their default, 0.
function varintField(field: number, value: number): number[] {
  return value === 0 ? [] : [...varint(field << 3), ...varint(value)]
}

// `KeyboardEvent.KeyCodeType` and `KeyEventType` (emulator_controller.proto).
export const KEY_CODE_EVDEV = 1
export type KeyEventType = 'down' | 'up'
const EVENT_TYPES: Record<KeyEventType, number> = { down: 0, up: 1 }

// `KeyboardEvent { codeType = 1; eventType = 2; keyCode = 3; }` with an evdev key code.
export function encodeKeyboardEvent(keyCode: number, eventType: KeyEventType): Uint8Array {
  return Uint8Array.from([
    ...varintField(1, KEY_CODE_EVDEV),
    ...varintField(2, EVENT_TYPES[eventType]),
    ...varintField(3, keyCode)
  ])
}

// `VmRunState { RunState state = 1; }`: 1 is RUNNING; an empty message is UNKNOWN (0).
export function decodeVmRunState(message: Uint8Array): { state: number; running: boolean } {
  let state = 0
  let at = 0
  const read = (): number => {
    let value = 0
    let scale = 1
    for (;;) {
      const byte = message[at++]
      if (byte === undefined) throw new Error('Truncated protobuf varint')
      value += (byte & 0x7f) * scale
      if ((byte & 0x80) === 0) return value
      scale *= 128
    }
  }
  while (at < message.length) {
    const tag = read()
    if ((tag & 7) !== 0) throw new Error(`Unexpected protobuf wire type ${tag & 7}`)
    const value = read()
    if (tag >> 3 === 1) state = value
  }
  return { state, running: state === 1 }
}

// `Image { ImageFormat format = 1; …; bytes image = 4; …; uint64 timestampUs = 6; }`: the PNG in
// field 4 (fixtures/0.24/emulator-grpc/get-screenshot.json). Every other field is skipped by its
// wire type, so fields this doesn't know don't break it. Throws when field 4 is absent.
export function decodeImage(message: Uint8Array): Uint8Array {
  let at = 0
  let image: Uint8Array | undefined
  const read = (): number => {
    let value = 0
    let scale = 1
    for (;;) {
      const byte = message[at++]
      if (byte === undefined) throw new Error('Truncated protobuf varint')
      value += (byte & 0x7f) * scale
      if ((byte & 0x80) === 0) return value
      scale *= 128
    }
  }
  const skip = (bytes: number) => {
    if (at + bytes > message.length) throw new Error('Truncated protobuf field')
    at += bytes
  }
  while (at < message.length) {
    const tag = read()
    const wireType = tag & 7
    if (wireType === 0) read()
    else if (wireType === 1) skip(8)
    else if (wireType === 5) skip(4)
    else if (wireType === 2) {
      const length = read()
      const start = at
      skip(length)
      if (Math.floor(tag / 8) === 4) image = message.subarray(start, start + length)
    } else throw new Error(`Unexpected protobuf wire type ${wireType}`)
  }
  if (!image) throw new Error('The Image message has no image')
  return image
}
