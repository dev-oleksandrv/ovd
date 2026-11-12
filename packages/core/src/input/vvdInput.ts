import { OvdError } from '../errors/ovdError.js'
import type { Emulator } from '../vvd/emulator.js'
import type { KeyEvent } from '../vvd/emulatorGrpc.js'
import { GRPC_KEYS, type RemoteKey } from './keys.js'
import { KEY_LEFTSHIFT, usKey } from './usKeyboard.js'

// Down then up for each key, the way `sendKey` reached apps on the Virtual Device.
export function pressEvents(keys: RemoteKey[]): KeyEvent[] {
  return keys.flatMap((key) => {
    const keyCode = GRPC_KEYS[key]
    // Callers refuse Home on the Virtual Device before anything is sent.
    if (keyCode === undefined) throw new Error(`No gRPC key code for ${key}`)
    return tap(keyCode)
  })
}

// One key per character on a US layout, shifted characters wrapped in KEY_LEFTSHIFT down and up
// (ARCHITECTURE §8: `KeyboardEvent.text` garbled capitals). Callers refuse anything outside
// printable ASCII first.
export function textEvents(text: string): KeyEvent[] {
  return [...text].flatMap((char) => {
    const key = usKey(char)
    if (!key) throw new Error('Text outside printable ASCII')
    if (!key.shift) return tap(key.code)
    return [
      { keyCode: KEY_LEFTSHIFT, eventType: 'down' as const },
      ...tap(key.code),
      { keyCode: KEY_LEFTSHIFT, eventType: 'up' as const }
    ]
  })
}

function tap(keyCode: number): KeyEvent[] {
  return [
    { keyCode, eventType: 'down' },
    { keyCode, eventType: 'up' }
  ]
}

// Sends a sequence; a sequence with a shift down that failed part-way still gets a shift up, so
// a stuck shift doesn't garble whatever is typed next. With gRPC off nothing was sent. An abort
// (`signal`) stops the sequence; the shift up still goes, without the signal.
export async function sendEvents(
  emulator: Pick<Emulator, 'sendKeys'>,
  vdaSerial: string,
  events: KeyEvent[],
  signal?: AbortSignal
): Promise<void> {
  try {
    await emulator.sendKeys(vdaSerial, events, signal ? { signal } : {})
  } catch (error) {
    const off = error instanceof OvdError && error.details?.off === true
    const shifted = events.some((e) => e.keyCode === KEY_LEFTSHIFT && e.eventType === 'down')
    if (shifted && !off) {
      await emulator
        .sendKeys(vdaSerial, [{ keyCode: KEY_LEFTSHIFT, eventType: 'up' }])
        .catch(() => undefined)
    }
    throw error
  }
}
