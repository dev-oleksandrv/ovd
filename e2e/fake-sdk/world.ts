import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The fake SDK's view of the host: what is plugged in, running and signed in. Tests set it up,
// the fake `vega` reads and updates it, so a flow sees the same effects a real SDK has
// (a started Virtual Device is listed, a switched stick leaves USB).
export interface World {
  // `vega --version` from the Vega CLI (SDK Manager) or the `vega` bundled inside an SDK.
  cli: 'manager' | 'bundled'
  vda: 'ok' | 'broken'
  // `expired`: `vega devmode login` says already signed in, but the session is rejected.
  account: 'signed-in' | 'signed-out' | 'expired'
  // When signed out: whether the user finishes the sign-in in the browser.
  browserSignIn: 'completes' | 'never'
  // The Developer Mode code the TV shows.
  tvCode: string
  stick: Stick | null
  vvd: { running: boolean; developerMode: boolean }
  // Addresses VDA holds a connection to (`vda connect`), kept across stick power cycles.
  vdaConnected: string[]
}

export interface Stick {
  developerMode: boolean
  // `tcpip`: listening on STICK_PORT (`vda tcpip` or Connection Mode on the TV), gone from USB.
  mode: 'usb' | 'tcpip'
  usbCable: boolean
  powered: boolean
  // Until this time (epoch ms) the stick is rebooting and not listed.
  rebootingUntil: number
}

// The values the recorded fixtures carry (fixtures/0.24/README.md); the fake can only answer
// with them, so tests use them too.
export const STICK_SERIAL = 'G070000000000001'
export const STICK_IP = '192.0.2.42'
export const STICK_PORT = 5555
export const STICK_ADDRESS = `${STICK_IP}:${STICK_PORT}`
export const VVD_VDA_SERIAL = 'emulator-5554'

export function defaultWorld(): World {
  return {
    cli: 'manager',
    vda: 'ok',
    account: 'signed-in',
    browserSignIn: 'completes',
    tvCode: 'ABC123',
    stick: null,
    vvd: { running: false, developerMode: true },
    vdaConnected: []
  }
}

// A stick with Developer Mode on, plugged in over USB.
export function usbStick(overrides: Partial<Stick> = {}): Stick {
  return {
    developerMode: true,
    mode: 'usb',
    usbCable: true,
    powered: true,
    rebootingUntil: 0,
    ...overrides
  }
}

export function worldFile(dir: string): string {
  return join(dir, 'world.json')
}

export function callsFile(dir: string): string {
  return join(dir, 'calls.jsonl')
}

export function readWorld(dir: string): World {
  return JSON.parse(readFileSync(worldFile(dir), 'utf8')) as World
}

// Write then rename, so a `vega` started at the same moment never reads half a file.
export function writeWorld(dir: string, world: World): void {
  const tmp = `${worldFile(dir)}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(world, null, 2)}\n`)
  renameSync(tmp, worldFile(dir))
}

export interface Call {
  command: string
  handled: boolean
}
