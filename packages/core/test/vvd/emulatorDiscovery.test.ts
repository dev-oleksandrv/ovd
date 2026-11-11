import { mkdtemp, mkdir, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { discoveryDirectories, findDiscovery } from '../../src/vvd/emulatorDiscovery.js'
import { fixture } from '../support/fixtures.js'

const recorded = fixture('0.24/emulator-discovery/virtual-device.ini')

describe('discoveryDirectories', () => {
  test.each([
    [
      'macOS',
      { platform: 'darwin', env: {}, uid: 501 },
      ['/home/developer/Library/Caches/TemporaryItems/avd/running']
    ],
    [
      'Linux with XDG_RUNTIME_DIR',
      { platform: 'linux', env: { XDG_RUNTIME_DIR: '/run/user/1000' }, uid: 1000 },
      [
        '/run/user/1000/avd/running',
        '/run/user/1000/avd/running',
        '/home/developer/.android/avd/running'
      ]
    ],
    [
      'Linux without it or a uid',
      { platform: 'linux', env: {} },
      ['/home/developer/.android/avd/running']
    ],
    [
      'the env override replaces the list',
      { platform: 'darwin', env: { OVD_EMULATOR_DISCOVERY_DIR: '/tmp/sandbox/avd' } },
      ['/tmp/sandbox/avd']
    ]
  ] as const)('%s', (_, opts, expected) => {
    expect(discoveryDirectories({ homedir: '/home/developer', ...opts })).toEqual(expected)
  })
})

describe('findDiscovery', () => {
  async function folder(files: Record<string, { text: string; mtime?: number }>) {
    const dir = await mkdtemp(join(tmpdir(), 'ovd-discovery-'))
    for (const [name, { text, mtime }] of Object.entries(files)) {
      const file = join(dir, name)
      await writeFile(file, text)
      if (mtime !== undefined) await utimes(file, mtime, mtime)
    }
    return dir
  }
  const alive =
    (...pids: number[]) =>
    (pid: number) =>
      pids.includes(pid)

  test('reads the live emulator’s file', async () => {
    const dir = await folder({ 'pid_4242.ini': { text: recorded } })
    expect(await findDiscovery({ directories: [dir], isAlive: alive(4242) }, 5554)).toMatchObject({
      consolePort: 5554,
      grpcPort: 8554
    })
  })

  test('a stale file of a crashed emulator is ignored', async () => {
    const dir = await folder({ 'pid_4242.ini': { text: recorded } })
    expect(await findDiscovery({ directories: [dir], isAlive: alive() }, 5554)).toBeNull()
  })

  test('another console port, other files and missing folders are skipped', async () => {
    const dir = await folder({
      'pid_1.ini': { text: recorded.replace('port.serial=5554', 'port.serial=5556') },
      'pid_2.ini': { text: 'half written' },
      'notes.txt': { text: recorded },
      'pid_x.ini': { text: recorded }
    })
    await mkdir(join(dir, 'pid_3.ini'))
    const deps = { directories: ['/nonexistent/ovd-avd', dir], isAlive: alive(1, 2, 3) }
    expect(await findDiscovery(deps, 5554)).toBeNull()
    expect(await findDiscovery(deps, 5556)).toMatchObject({ consolePort: 5556 })
  })

  test('the newest of two live files wins', async () => {
    const dir = await folder({
      'pid_10.ini': { text: recorded.replace('grpc.port=8554', 'grpc.port=8600'), mtime: 1_000 },
      'pid_11.ini': { text: recorded, mtime: 2_000 }
    })
    const found = await findDiscovery({ directories: [dir], isAlive: alive(10, 11) }, 5554)
    expect(found?.grpcPort).toBe(8554)
  })
})
