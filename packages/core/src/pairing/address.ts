import { OvdError } from '../errors/ovdError.js'

export const DEFAULT_PORT = 5555

export interface Address {
  host: string
  port: number
  // The ID VDA and OVD use for a Wi‑Fi device.
  id: string
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HOSTNAME =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/

// `<ip>[:port]`, checked before VDA sees it: VDA answers a bad address with exit 0 and a
// one-line complaint (fixtures/0.24/vda-connect/bad-port.txt).
export function parseAddress(input: string, defaultPort = DEFAULT_PORT): Address {
  const text = input.trim()
  const colon = text.lastIndexOf(':')
  const host = colon === -1 ? text : text.slice(0, colon)
  const portText = colon === -1 ? String(defaultPort) : text.slice(colon + 1)
  if (!isHost(host)) {
    throw new OvdError(
      'INVALID_ADDRESS',
      `${text || 'An empty address'} is not an IP address`,
      'Find the IP on the TV in Settings → My Fire TV → About → Network'
    )
  }
  const port = parsePort(portText)
  return { host, port, id: `${host}:${port}` }
}

export function parsePort(text: string): number {
  const port = Number(text)
  if (!/^\d+$/.test(text) || port <= 1024 || port > 65535) {
    throw new OvdError(
      'INVALID_ADDRESS',
      `Port ${text} is not valid`,
      'Port must be a number above 1024 (the default is 5555)'
    )
  }
  return port
}

function isHost(host: string): boolean {
  const ip = IPV4.exec(host)
  if (ip) return ip.slice(1).every((part) => Number(part) <= 255)
  return HOSTNAME.test(host) && !/^[\d.]+$/.test(host)
}

export interface HostNetwork {
  address: string
  cidr: string
}

// The host's own IPv4 networks that contain `ip`, or none: a timeout to an address outside
// every one of them is a different-network problem, not a blocked port.
export function onHostNetwork(ip: string, networks: HostNetwork[]): boolean {
  const target = toInt(ip)
  if (target === null) return true
  return networks.some((n) => {
    const [base, bits] = n.cidr.split('/')
    const start = base === undefined ? null : toInt(base)
    const prefix = Number(bits)
    if (start === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
    const mask = maskOf(prefix)
    return (start & mask) >>> 0 === (target & mask) >>> 0
  })
}

// `198.51.100.7/24` → `198.51.100.0/24`, the way users read a network.
export function networkCidr(cidr: string): string {
  const [base = '', bits = ''] = cidr.split('/')
  const start = toInt(base)
  const prefix = Number(bits)
  if (start === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return cidr
  const net = (start & maskOf(prefix)) >>> 0
  return `${[24, 16, 8, 0].map((shift) => (net >>> shift) & 255).join('.')}/${prefix}`
}

function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
}

function toInt(ip: string): number | null {
  const parts = IPV4.exec(ip)?.slice(1).map(Number)
  if (!parts || parts.some((p) => p > 255)) return null
  return parts.reduce((acc, p) => ((acc << 8) | p) >>> 0, 0)
}
