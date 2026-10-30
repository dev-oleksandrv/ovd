import { networkInterfaces } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import type { ActivityLog } from '../activity/activityLog.js'
import { createLogged } from '../activity/logged.js'
import { parseFibTrie } from '../adapters/parseFibTrie.js'
import { parseVdaConnect } from '../adapters/parseVdaConnect.js'
import { parseVdaTcpip } from '../adapters/parseVdaTcpip.js'
import { canonicalId } from '../devices/deviceModel.js'
import type { Devices } from '../devices/devices.js'
import type { Device } from '../devices/types.js'
import { OvdError } from '../errors/ovdError.js'
import { vdaCmd } from '../sdk/commands.js'
import type { Runner, RunResult } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import type { StateStore } from '../state/stateStore.js'
import {
  DEFAULT_PORT,
  networkCidr,
  onHostNetwork,
  parseAddress,
  type Address,
  type HostNetwork
} from './address.js'

export interface PairingDeps {
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  state: StateStore
  activity: ActivityLog
  // Injected so tests wait without real timers and see a fixed host network.
  sleep?: (ms: number) => Promise<void>
  hostNetworks?: () => HostNetwork[]
}

export interface Pairing {
  // Switches a stick on USB to TCP/IP and connects to it over Wi‑Fi. `device` picks the stick
  // when several are plugged in.
  pairUsb(opts?: { device?: string; port?: number }): Promise<Device>
  // Connects to a stick already listening on TCP/IP (`<ip>[:port]`) and remembers it.
  pair(address: string): Promise<Device>
  // Connects again to a remembered device, or to any `<ip>[:port]`.
  connect(id: string): Promise<Device>
  forget(id: string): Promise<{ id: string }>
  // Connects every remembered device that VDA has lost track of (after a host or VDA restart).
  // For the desktop at launch and on Rescan; failures are left for the user to retry.
  reconnectSaved(): Promise<void>
}

// VDA gives up after 47–75 s (fixtures/0.24/vda-connect/timed-out.txt); a stick on the same
// network answers in under 2 s, so waiting longer only delays the error.
const CONNECT_TIMEOUT_MS = 20_000
const RECONNECT_TIMEOUT_MS = 5_000
const POLL_MS = 1_000
// The stick restarts its VDA daemon after `tcpip`; connects right after can be refused.
const TCPIP_CONNECT_ATTEMPTS = 10
const LISTED_ATTEMPTS = 10

export function createPairing(deps: PairingDeps): Pairing {
  const logged = createLogged(deps.activity)
  const sleep = deps.sleep ?? ((ms: number) => delay(ms))
  const hostNetworks = deps.hostNetworks ?? defaultHostNetworks

  async function vda(args: string[], vdaSerial?: string, timeoutMs?: number): Promise<RunResult> {
    const { vegaPath } = await deps.sdk.get()
    return deps.runner.run(
      vdaCmd(vegaPath, args, vdaSerial, timeoutMs === undefined ? {} : { timeoutMs })
    )
  }

  // One `vda connect`, its outcome mapped to an error the user can act on.
  async function connectOnce(address: Address, timeoutMs = CONNECT_TIMEOUT_MS): Promise<void> {
    let stdout: string
    try {
      stdout = (await vda(['connect', address.id], undefined, timeoutMs)).stdout
    } catch (error) {
      if (error instanceof OvdError && error.details?.timedOut === true) {
        throw timedOut(address)
      }
      throw error
    }
    const outcome = parseVdaConnect(stdout)
    switch (outcome.result) {
      case 'connected':
        return
      case 'refused':
        throw new OvdError(
          'PAIR_REFUSED',
          `${address.id} refused the connection`,
          `Check the port: the stick listens on the port set with vda tcpip or in Connection Mode (default ${DEFAULT_PORT})`,
          { stdout: outcome.message }
        )
      case 'timed-out':
        throw timedOut(address)
      case 'bad-address':
        throw new OvdError('INVALID_ADDRESS', outcome.message, 'Check the IP address and port')
    }
  }

  function timedOut(address: Address): OvdError {
    const networks = hostNetworks()
    if (!onHostNetwork(address.host, networks)) {
      const on = networks.map((n) => networkCidr(n.cidr)).join(', ') || 'no network'
      return new OvdError(
        'DIFFERENT_NETWORK',
        `This computer is on ${on}, but ${address.host} is on another network`,
        'Connect both to the same Wi‑Fi, then retry'
      )
    }
    return new OvdError(
      'PAIR_TIMEOUT',
      `${address.id} didn’t answer`,
      `Check the stick is on. A firewall on this computer or the router may be blocking TCP port ${address.port}; allow it, then retry`
    )
  }

  async function waitListed(id: string): Promise<Device> {
    for (let i = 0; i < LISTED_ATTEMPTS; i++) {
      const { devices } = await deps.devices.list()
      const device = devices.find((d) => d.id === id && d.status === 'online')
      if (device) return device
      await sleep(POLL_MS)
    }
    throw new OvdError(
      'PAIR_TIMEOUT',
      `Connected to ${id}, but VDA doesn’t list it online`,
      `Retry with ovd connect ${id}`
    )
  }

  async function remember(id: string, serial?: string): Promise<void> {
    await deps.state.update((s) => {
      const known = s.saved.find((d) => d.id === id)
      // An address paired again by IP keeps the serial a USB pairing learned.
      const keep = serial ?? known?.serial
      const entry = {
        id,
        ...(keep === undefined ? {} : { serial: keep }),
        savedAt: new Date().toISOString()
      }
      return { ...s, saved: [...s.saved.filter((d) => d.id !== id), entry] }
    })
  }

  async function connectAndSave(address: Address): Promise<Device> {
    await connectOnce(address)
    await remember(address.id)
    return waitListed(address.id)
  }

  async function usbStick(device: string | undefined): Promise<Device> {
    const { devices } = await deps.devices.list()
    const usb = devices.filter((d) => d.connection === 'usb' && d.status === 'online')
    if (device !== undefined) {
      const found = usb.find((d) => d.id === canonicalId(device))
      if (found) return found
      throw new OvdError(
        'DEVICE_NOT_FOUND',
        `No stick ${device} on USB`,
        'See connected devices: ovd devices'
      )
    }
    const [only, ...more] = usb
    if (!only) {
      throw new OvdError(
        'DEVICE_NOT_FOUND',
        'No stick is plugged in over USB',
        'Plug the stick in over USB. It needs Developer Mode: ovd setup-stick'
      )
    }
    if (more.length > 0) {
      throw new OvdError(
        'NO_TARGET',
        'Several sticks are plugged in over USB',
        'Pick one: ovd pair --usb --device <serial>'
      )
    }
    return only
  }

  async function stickIp(stick: Device): Promise<string> {
    const run = await vda(['shell', 'cat', '/proc/net/fib_trie'], stick.vdaSerial ?? stick.id)
    if (run.exitCode !== 0) {
      throw new OvdError(
        'COMMAND_FAILED',
        'Couldn’t read the stick’s IP address',
        'Pair without USB instead: ovd pair <ip> (the IP is in Settings → My Fire TV → About → Network)',
        { exitCode: run.exitCode, stderr: run.stderr.slice(-500) }
      )
    }
    const [ip] = parseFibTrie(run.stdout)
    if (!ip) {
      throw new OvdError(
        'COMMAND_FAILED',
        'The stick isn’t on a network',
        'Connect the stick to Wi‑Fi in Settings → Network, then retry'
      )
    }
    return ip
  }

  return {
    async pairUsb(opts = {}) {
      const stick = await usbStick(opts.device)
      const serial = stick.id
      const port = opts.port ?? DEFAULT_PORT
      // Read before switching: once in TCP/IP mode the stick is gone from USB.
      const ip = await stickIp(stick)
      const address = parseAddress(`${ip}:${port}`)

      await logged('pair.tcpip', serial, { port: String(port) }, async () => {
        const run = await vda(['tcpip', String(port)], stick.vdaSerial ?? serial)
        if (run.exitCode !== 0) {
          throw new OvdError(
            'COMMAND_FAILED',
            'Couldn’t switch the stick to TCP/IP',
            'Unplug the stick, plug it back in and retry',
            { exitCode: run.exitCode, stderr: run.stderr.slice(-500) }
          )
        }
        parseVdaTcpip(run.stdout)
      })

      return logged('pair.connect', address.id, { from: serial }, async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            await connectOnce(address)
            break
          } catch (error) {
            const refused = error instanceof OvdError && error.code === 'PAIR_REFUSED'
            if (!refused || attempt >= TCPIP_CONNECT_ATTEMPTS) throw error
            await sleep(POLL_MS)
          }
        }
        await remember(address.id, serial)
        // The stick keeps its target role under its Wi‑Fi ID: it is the same device.
        await deps.state.update((s) => (s.target === serial ? { ...s, target: address.id } : s))
        return waitListed(address.id)
      })
    },

    async pair(input) {
      const address = parseAddress(input)
      return logged('pair.connect', address.id, {}, () => connectAndSave(address))
    },

    async connect(id) {
      const address = parseAddress(id)
      return logged('connect', address.id, {}, () => connectAndSave(address))
    },

    forget(input) {
      const id = canonicalId(input.trim())
      return logged('forget', id, {}, async () => {
        const { state } = await deps.state.read()
        const saved = state.saved.find((d) => d.id === id)
        const run = await vda(['disconnect', id])
        // Exit 1 "no such device" just means VDA wasn't connected to it
        // (fixtures/0.24/vda-disconnect/no-such-device.stderr.txt).
        const notConnected = run.exitCode !== 0 && /no such device/.test(run.stderr)
        if (run.exitCode !== 0 && !notConnected) {
          throw new OvdError(
            'COMMAND_FAILED',
            `Couldn’t disconnect ${id}`,
            'Run vega exec vda disconnect in a terminal to see why',
            { exitCode: run.exitCode, stderr: run.stderr.slice(-500) }
          )
        }
        if (!saved && notConnected) {
          throw new OvdError(
            'DEVICE_NOT_FOUND',
            `No saved device ${input}`,
            'See connected devices: ovd devices'
          )
        }
        await deps.state.update((s) => {
          const names = { ...s.names }
          // A stick without a known serial was named under its ID.
          if (!saved?.serial) delete names[id]
          const { target, ...rest } = s
          return {
            ...rest,
            ...(target === undefined || target === id ? {} : { target }),
            names,
            saved: s.saved.filter((d) => d.id !== id)
          }
        })
        return { id }
      })
    },

    async reconnectSaved() {
      const { devices } = await deps.devices.list()
      // Saved and not in the VDA list at all; an `offline` entry VDA reconnects by itself.
      const lost = devices.filter((d) => d.saved && d.vdaSerial === undefined)
      for (const device of lost) {
        try {
          // Not logged: OVD does this on its own on every launch and Rescan, and an
          // unreachable stick would fill the activity log with timeouts.
          await connectOnce(parseAddress(device.id), RECONNECT_TIMEOUT_MS)
        } catch (error) {
          if (!(error instanceof OvdError)) throw error
        }
      }
    }
  }
}

function defaultHostNetworks(): HostNetwork[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((n) => n.family === 'IPv4' && !n.internal && n.cidr !== null)
    .map((n) => ({ address: n.address, cidr: n.cidr ?? '' }))
}
