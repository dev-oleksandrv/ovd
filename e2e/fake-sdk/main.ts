// The fake `vega`: answers each command core runs with a recorded output from fixtures/0.24
// and its recorded exit code, and applies the command's effect to the world. A command with
// no recording fails loudly and is logged as unhandled, which fails the test.
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  callsFile,
  readWorld,
  STICK_ADDRESS,
  STICK_IP,
  STICK_PORT,
  STICK_SERIAL,
  VVD_VDA_SERIAL,
  writeWorld,
  type World
} from './world.ts'

interface Reply {
  stdout?: string
  stderr?: string
  exitCode?: number
}

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/0.24')
// How long the user takes to finish the browser sign-in (32 s in the recording).
const BROWSER_SIGN_IN_MS = 300
const UNHANDLED = 99

const dir = process.env.OVD_FAKE_SDK_DIR
if (!dir) {
  process.stderr.write('fake-sdk: OVD_FAKE_SDK_DIR is not set\n')
  process.exit(UNHANDLED)
}

const args = process.argv.slice(2)
const command = ['vega', ...args].join(' ')
const world = readWorld(dir)

function fixture(path: string): string {
  return readFileSync(join(FIXTURES, path), 'utf8')
}

function line(path: string, index: number): string {
  const found = fixture(path).split('\n')[index]
  if (found === undefined) throw new Error(`fake-sdk: ${path} has no line ${index}`)
  return found
}

let logged = false
function log(handled: boolean): void {
  if (logged) return
  logged = true
  appendFileSync(callsFile(dir as string), `${JSON.stringify({ command, handled })}\n`)
}

// Set by a command that keeps running after its first output: other commands change the world
// meanwhile, so it writes its own effect and the stale copy is not written back.
let wroteWorld = false

function stickOnUsb(w: World): boolean {
  const s = w.stick
  return (
    s !== null &&
    s.developerMode &&
    s.mode === 'usb' &&
    s.usbCable &&
    s.powered &&
    s.rebooting === 0
  )
}

function stickOnWifi(w: World): boolean {
  const s = w.stick
  return s !== null && s.developerMode && s.mode === 'tcpip' && s.powered && s.rebooting === 0
}

// `vda devices -l` prints a header and one line per device. Each line is taken verbatim from
// a recording of that device in that state, so any combination can be listed.
function vdaDevices(w: World): string {
  const lines = [line('vda-devices/none.txt', 0)]
  if (stickOnUsb(w)) lines.push(line('vda-devices/stick-usb.txt', 1))
  for (const address of w.vdaConnected) {
    if (address !== STICK_ADDRESS) continue
    lines.push(
      stickOnWifi(w)
        ? line('vda-devices/stick-wifi.txt', 1)
        : line('vda-devices/stick-wifi-offline.txt', 1)
    )
  }
  if (w.vvd.running) lines.push(line('vda-devices/stick-usb-and-virtual-device.txt', 2))
  // A rebooting stick is gone for this many polls (41 s in the recording).
  if (w.stick && w.stick.rebooting > 0) w.stick.rebooting -= 1
  return `${lines.join('\n')}\n\n`
}

function deviceInfo(w: World, id: string): Reply {
  if (id === STICK_SERIAL && stickOnUsb(w))
    return { stdout: fixture('vega-device-info/stick-usb.json') }
  if (id === STICK_ADDRESS && stickOnWifi(w) && w.vdaConnected.includes(STICK_ADDRESS)) {
    return { stdout: fixture('vega-device-info/stick-wifi.json') }
  }
  if (id === 'VirtualDevice' && w.vvd.running) {
    return {
      stdout: fixture(
        w.vvd.developerMode
          ? 'vega-device-info/virtual-device.json'
          : 'vega-device-info/virtual-device-developer-mode-off.json'
      )
    }
  }
  // Unknown, offline and booting devices all print this, with exit 0.
  return { stdout: fixture('vega-device-info/unavailable.json') }
}

async function devmodeLogin(w: World): Promise<Reply> {
  if (w.account !== 'signed-out') {
    return { stdout: fixture('vega-devmode-login/signed-in.json'), exitCode: 2 }
  }
  // Logged now: the process may be stopped before it answers.
  log(true)
  if (w.browserSignIn === 'never') {
    // Prints the pending answer, then waits until it is stopped.
    process.stdout.write(fixture('vega-devmode-login/signed-out.json'))
    await new Promise(() => setInterval(() => undefined, 60_000))
  }
  const [pending, success] = fixture('vega-devmode-login/signed-in-after-browser.json').split(
    /(?<=^\})\n/m
  )
  process.stdout.write(`${pending}\n`)
  await new Promise((resolve) => setTimeout(resolve, BROWSER_SIGN_IN_MS))
  const fresh = readWorld(dir as string)
  fresh.account = 'signed-in'
  writeWorld(dir as string, fresh)
  wroteWorld = true
  return { stdout: success ?? '' }
}

function enableDevice(w: World, rest: string[]): Reply | null {
  const code = rest[1]
  if (rest[0] !== '--code' || code === undefined || rest.at(-1) !== '--json') return null
  if (w.account !== 'signed-in') {
    return { stdout: fixture('vega-devmode-enable-device/not-signed-in.json'), exitCode: 2 }
  }
  if (code !== w.tvCode || !w.stick) {
    return { stdout: fixture('vega-devmode-enable-device/invalid-code.json'), exitCode: 6 }
  }
  // The stick reboots: it leaves the device list at once and comes back on USB.
  w.stick.developerMode = true
  w.stick.rebooting = 1
  return { stdout: fixture('vega-devmode-enable-device/enabled.json') }
}

function vda(w: World, rest: string[]): Reply | null {
  const [first, ...more] = rest
  if (w.vda === 'broken') {
    return { stdout: fixture('vda-devices/vda-missing-errno.txt'), exitCode: 2 }
  }
  if (first === 'version' && more.length === 0) return { stdout: fixture('vda-version/ok.txt') }
  if (first === 'devices' && more.join(' ') === '-l') return { stdout: vdaDevices(w) }
  if (first === 'connect' && more.length === 1) return connect(w, more[0] as string)
  if (first === 'disconnect' && more.length === 1) {
    const address = more[0] as string
    if (address !== STICK_ADDRESS) return null
    if (!w.vdaConnected.includes(address)) {
      return { stderr: fixture('vda-disconnect/no-such-device.stderr.txt'), exitCode: 1 }
    }
    w.vdaConnected = w.vdaConnected.filter((a) => a !== address)
    return { stdout: fixture('vda-disconnect/disconnected.txt') }
  }
  if (first === '-s' && more.length > 1) return vdaOn(w, more[0] as string, more.slice(1))
  return null
}

function connect(w: World, address: string): Reply | null {
  if (address === STICK_ADDRESS && stickOnWifi(w)) {
    if (w.vdaConnected.includes(address)) {
      return { stdout: fixture('vda-connect/already-connected.txt') }
    }
    w.vdaConnected.push(address)
    return { stdout: fixture('vda-connect/connected.txt') }
  }
  // VDA reports both with exit 0.
  if (address === `${STICK_IP}:5556` && stickOnWifi(w)) {
    return { stdout: fixture('vda-connect/refused.txt') }
  }
  if (address === '192.0.2.1:5555') return { stdout: fixture('vda-connect/timed-out.txt') }
  return null
}

function vdaOn(w: World, serial: string, rest: string[]): Reply | null {
  const sub = rest.join(' ')
  if (serial === VVD_VDA_SERIAL && w.vvd.running) {
    if (sub === 'shell vsm developer-mode') {
      return {
        stdout: fixture(
          w.vvd.developerMode ? 'vsm-developer-mode/enabled.txt' : 'vsm-developer-mode/disabled.txt'
        )
      }
    }
    if (sub === 'shell vsm developer-mode enable') {
      w.vvd.developerMode = true
      return { stdout: fixture('vsm-developer-mode-set/enabled.txt') }
    }
    return null
  }
  if (serial === STICK_SERIAL) {
    if (sub === `tcpip ${STICK_PORT}`) {
      if (!stickOnUsb(w) || !w.stick) {
        return { stderr: fixture('vda-tcpip/device-not-found.stderr.txt'), exitCode: 1 }
      }
      w.stick.mode = 'tcpip'
      return { stdout: fixture('vda-tcpip/restarting.txt') }
    }
    if (sub === 'shell cat /proc/net/fib_trie' && stickOnUsb(w)) {
      return { stdout: fixture('vda-shell-fib-trie/stick.txt') }
    }
    return null
  }
  if (serial === STICK_ADDRESS && sub === 'usb' && w.stick && stickOnWifi(w)) {
    // VDA keeps the Wi‑Fi entry, now offline (vda-devices/stick-usb-and-wifi-offline.txt).
    w.stick.mode = 'usb'
    return { stdout: fixture('vda-usb/restarting.txt') }
  }
  return null
}

function virtualDevice(w: World, sub: string | undefined): Reply | null {
  if (sub === 'status') {
    return {
      stdout: fixture(
        w.vvd.running
          ? 'vega-virtual-device-status/running.json'
          : 'vega-virtual-device-status/stopped.json'
      )
    }
  }
  if (sub === 'start') {
    if (w.vvd.running) {
      return { stderr: fixture('vega-virtual-device-start/already-running.stderr.txt') }
    }
    w.vvd.running = true
    return { stdout: fixture('vega-virtual-device-start/started.txt') }
  }
  if (sub === 'stop') {
    if (!w.vvd.running) {
      return { stderr: fixture('vega-virtual-device-stop/not-running.stderr.txt'), exitCode: 1 }
    }
    // No recording: core only reads the exit code of a successful stop.
    w.vvd.running = false
    return {}
  }
  return null
}

async function answer(w: World): Promise<Reply | null> {
  const [first, second, ...rest] = args
  if (first === '--version' && second === undefined) {
    return { stdout: fixture(`vega-version/${w.cli}.txt`) }
  }
  if (w.cli === 'bundled' && (first === 'devmode' || first === 'sdk')) {
    return { stderr: fixture('vega-devmode-login/bundled-cli.stderr.txt'), exitCode: 253 }
  }
  if (first === 'sdk' && args.join(' ') === 'sdk config doctor --json') {
    return { stdout: fixture('vega-sdk-config-doctor/ok.json') }
  }
  if (first === 'exec' && second === 'vda') return vda(w, rest)
  if (first === 'virtual-device' && rest.length === 0) return virtualDevice(w, second)
  if (first === 'device' && second === 'info' && rest[0] === '--device' && rest.length === 2) {
    return deviceInfo(w, rest[1] as string)
  }
  if (first === 'device' && second === 'is-port-forwarded') {
    return { stdout: fixture('vega-device-is-port-forwarded/false.txt') }
  }
  if (first === 'devmode' && second === 'login' && rest.join(' ') === '--json') {
    return devmodeLogin(w)
  }
  if (first === 'devmode' && second === 'enable-device') return enableDevice(w, rest)
  return null
}

const reply = await answer(world)
log(reply !== null)
if (reply === null) {
  process.stderr.write(`fake-sdk: no recording for: ${command}\n`)
  process.exit(UNHANDLED)
}
if (!wroteWorld) writeWorld(dir, world)
if (reply.stdout) process.stdout.write(reply.stdout)
if (reply.stderr) process.stderr.write(reply.stderr)
process.exitCode = reply.exitCode ?? 0
