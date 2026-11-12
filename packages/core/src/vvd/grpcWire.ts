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

// `ImageFormat.ImgFormat` (emulator_controller.proto).
export type ImageFormatName = 'png' | 'rgba8888' | 'rgb888'
const IMAGE_FORMATS: Record<ImageFormatName, number> = { png: 0, rgba8888: 1, rgb888: 2 }
const RGBA8888 = 1

export interface ImageFormat {
  format: ImageFormatName
  width: number
  height: number
}

// `ImageFormat { ImgFormat format = 1; …; uint32 width = 3; uint32 height = 4; }`. The emulator
// scales the screen to `width`x`height`; 0 leaves it at the display's size.
export function encodeImageFormat(image: ImageFormat): Uint8Array {
  return Uint8Array.from([
    ...varintField(1, IMAGE_FORMATS[image.format]),
    ...varintField(3, image.width),
    ...varintField(4, image.height)
  ])
}

// One `streamScreenshot` frame: raw RGBA8888 pixels, row by row.
export interface ScreenFrame {
  width: number
  height: number
  // The emulator's frame number (absent, so 0, on the first).
  seq: number
  timestampUs: number
  pixels: Uint8Array
}

type Field = { field: number; value: number } | { field: number; bytes: Uint8Array }

// The fields of a protobuf message in order: varints as numbers, length-delimited fields as
// bytes; fixed-size fields are skipped. Throws on a truncated message or an unknown wire type.
function fields(message: Uint8Array): Field[] {
  const out: Field[] = []
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
  const skip = (bytes: number) => {
    if (at + bytes > message.length) throw new Error('Truncated protobuf field')
    at += bytes
  }
  while (at < message.length) {
    const tag = read()
    const field = Math.floor(tag / 8)
    const wireType = tag & 7
    if (wireType === 0) out.push({ field, value: read() })
    else if (wireType === 1) skip(8)
    else if (wireType === 5) skip(4)
    else if (wireType === 2) {
      const length = read()
      const start = at
      skip(length)
      out.push({ field, bytes: message.subarray(start, start + length) })
    } else throw new Error(`Unexpected protobuf wire type ${wireType}`)
  }
  return out
}

// `Image { ImageFormat format = 1; …; bytes image = 4; uint32 seq = 5; uint64 timestampUs = 6; }`
// with the real format, width and height in `format` (fixtures/0.24/emulator-grpc/
// stream-screenshot.json). Throws unless it is RGBA8888 with exactly width*height*4 bytes, so a
// surface never draws a frame of the wrong size.
export function decodeImageFrame(message: Uint8Array): ScreenFrame {
  let format = 0
  let width = 0
  let height = 0
  let seq = 0
  let timestampUs = 0
  let pixels: Uint8Array | undefined
  for (const f of fields(message)) {
    if (f.field === 1 && 'bytes' in f) {
      for (const g of fields(f.bytes)) {
        if (!('value' in g)) continue
        if (g.field === 1) format = g.value
        else if (g.field === 3) width = g.value
        else if (g.field === 4) height = g.value
      }
    } else if (f.field === 4 && 'bytes' in f) pixels = f.bytes
    else if (f.field === 5 && 'value' in f) seq = f.value
    else if (f.field === 6 && 'value' in f) timestampUs = f.value
  }
  if (format !== RGBA8888) throw new Error(`Unexpected image format ${format}`)
  if (!pixels || width === 0 || height === 0 || pixels.length !== width * height * 4) {
    throw new Error('The frame’s pixels don’t match its size')
  }
  return { width, height, seq, timestampUs, pixels }
}
