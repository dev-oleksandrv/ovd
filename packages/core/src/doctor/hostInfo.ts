import { readFile } from 'node:fs/promises'
import { arch, release } from 'node:os'
import type { HostInfo } from './types.js'

// `os.release()` is the kernel version, not the product version users know ("macOS 26.6"),
// so read the product files; fall back to the kernel version if they're unreadable.
export async function hostInfo(): Promise<HostInfo> {
  const base = { arch: arch(), node: process.versions.node }
  if (process.platform === 'darwin') {
    const plist = await readText('/System/Library/CoreServices/SystemVersion.plist')
    const version = /<key>ProductVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1]
    return { os: 'macOS', osVersion: version ?? release(), ...base }
  }
  const osRelease = await readText('/etc/os-release')
  const field = (key: string) => new RegExp(`^${key}="?([^"\\n]*)"?$`, 'm').exec(osRelease)?.[1]
  return { os: field('NAME') ?? 'Linux', osVersion: field('VERSION_ID') ?? release(), ...base }
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}
