import { describe, expect, test } from 'vitest'
import { compileLogFilter, type LogFilterInput } from '../../src/logs/logFilter.js'
import {
  logPresetKeys,
  logPresets,
  mergeLogFilter,
  resolvePreset,
  type SavedLogFilter
} from '../../src/logs/logPresets.js'
import type { LogEntry } from '../../src/logs/types.js'
import { parseLines } from './logLines.js'

const NOW = new Date('2026-11-08T12:00:00Z')

// Lines copied from fixtures/0.24/loggingctl-log/stick-follow.txt (the player's ticks, the
// launch lines of lcm_service and stemd, a lifecycle broadcast), then the network and
// lifecycle lines of a JS app, synthesized: the fixture has no network line yet.
const FIXTURE_LINES = `Nov 08 07:27:00.257342 firestick-0000000000000001 local0.info com.example.player[27178]: 2842092448 INFO com.amazon.keplerscript: [KeplerScript-JavaScript] player log tick 1
Nov 08 07:27:00.258692 firestick-0000000000000001 local0.err com.example.player[27178]: 2842092448 ERROR com.amazon.keplerscript: [KeplerScript-JavaScript] player error tick 1
Nov 08 07:27:00.263417 firestick-0000000000000001 local0.warning com.example.player[27178]: 2842092448 WARNING Volta: Volta:console.error: player error tick 1
Nov 08 07:26:59.934822 firestick-0000000000000001 local0.err lcm_service[899]: 1166 E resmgr-app-registry:[AppResourceRegistry.cpp:604] Removing 983:26107
Nov 08 07:26:59.935300 firestick-0000000000000001 local0.info servicergrd[740]: 3022369408 INFO com.amazon.appfwk.servicergrd: worker: dispatching LCM state update, service="com.amazon.network.service", client_pid=26107, service_pid=1037, reason=2, event=ClientDisconnected
Nov 08 07:27:00.624917 firestick-0000000000000001 local0.info lcm_service[899]: 899 I lcm-app-launch-service:[LcmAppLaunchServiceImpl.cpp:347] Received request: 'launch scheduled task for result' (8) from (uid:512, gid:0, pid:1684, securityCtx:System)
Nov 08 07:27:00.627110 firestick-0000000000000001 local0.info lcm_service[899]: 899 I lcm-server:[Lcm.cpp:4371] Received launch request for orpheus://com.amazon.appstorevegatv.native.onLcmLaunchTask
Nov 08 07:27:01.183464 firestick-0000000000000001 local0.info lcm_service[899]: 1166 I resmgr-app-state-mon:[AppStateChangeNotifier.cpp:197] no app state change monitoring, stop debounce timer
Nov 08 07:27:01.189672 firestick-0000000000000001 local0.info lcm_service[899]: 899 I lcm-app-control-ops-slim-service:[LcmAppControlOpsSlimImpl.cpp:298] Received request: 'apps in foreground' (33) from (uid:101, gid:0, pid:1727, securityCtx:System)
Nov 08 07:27:00.903715 firestick-0000000000000001 local0.info eventmgrd[898]: 2985603776 INFO com.amazon.message_router.core: [MessageRouterService.cpp:1845] Channel: 8 from pid: 899 Send request for message uri: broadcast://*/com.amazon.kepler.lifecycle_manager
Nov 08 07:27:00.865034 firestick-0000000000000001 local0.info stemd[801]: 3069526048 INFO com.amazon.appfwk.stemd: loop:event{type=StemEvent}:stem{pid=27242 id=905 rid=993 state="Ready" state="Launched"}: cleaning up stem
`
const SYNTHETIC_LINES = `Nov 08 07:27:02.100000 firestick-0000000000000001 local0.info com.example.player[27178]: 2842092448 INFO com.amazon.keplerscript: [KeplerScript-JavaScript] fetch ok 200 https://example.com/
Nov 08 07:27:02.200000 firestick-0000000000000001 local0.err com.example.player[27178]: 2842092448 ERROR com.amazon.keplerscript: [KeplerScript-JavaScript] fetch failed: TypeError: Network request failed (https://nonexistent.invalid/)
Nov 08 07:27:02.300000 firestick-0000000000000001 local0.info com.example.player[27178]: 2842092448 INFO com.amazon.keplerscript: [KeplerScript-JavaScript] XMLHttpRequest done
Nov 08 07:27:02.400000 firestick-0000000000000001 local0.warning com.example.player[27178]: 2842092448 WARNING com.amazon.keplerscript: [KeplerScript-JavaScript] request timeout after 5000 ms
Nov 08 07:27:02.500000 firestick-0000000000000001 local0.info netmgrd[600]: 700 INFO wifi-monitor: wifi link up
Nov 08 07:27:02.600000 firestick-0000000000000001 local0.info com.example.player[27178]: 2842092448 INFO com.amazon.keplerscript: [KeplerScript-JavaScript] SSL handshake ok
Nov 08 07:27:02.700000 firestick-0000000000000001 local0.info com.example.player[27178]: 2842092448 INFO com.amazon.keplerscript: [KeplerScript-JavaScript] classloader ready, no sockets here
Nov 08 07:27:02.800000 firestick-0000000000000001 local0.info com.example.player[27178]: 2842092448 INFO com.amazon.keplerscript: [KeplerScript-JavaScript] GWSI_LOG Window 1 lifecycle state changed: Visible -> Unbound
Nov 08 07:27:02.900000 firestick-0000000000000001 local0.info com.example.player[27178]: 2842092448 INFO com.amazon.keplerscript: [KeplerScript-JavaScript] app moved to background
Nov 08 07:27:03.000000 firestick-0000000000000001 local0.info lcm_service[899]: 899 I lcm-server:[Lcm.cpp:4412] Terminated app com.example.player
Nov 08 07:27:03.100000 firestick-0000000000000001 local0.info com.example.player[27178]: 2842092448 INFO com.amazon.keplerscript: [KeplerScript-JavaScript] player log tick 9
`
const ENTRIES: LogEntry[] = parseLines(FIXTURE_LINES + SYNTHETIC_LINES)

const kept = (input: LogFilterInput) => {
  const filter = compileLogFilter(input, NOW)
  return ENTRIES.filter((e) => filter.matches(e)).map((e) => e.message.slice(0, 60))
}
const preset = (key: string) => resolvePreset(key)

describe('the built-in presets', () => {
  test('are all, app-errors, network and lifecycle, with labels', () => {
    expect(logPresets().map((p) => [p.key, p.label])).toEqual([
      ['all', 'All'],
      ['app-errors', 'App errors only'],
      ['network', 'Network'],
      ['lifecycle', 'Lifecycle']
    ])
    expect(logPresetKeys()).toEqual(['all', 'app-errors', 'network', 'lifecycle'])
  })

  test('every preset compiles, so every regex passes assertSafeRegex', () => {
    for (const { key } of logPresets()) {
      expect(() => compileLogFilter(preset(key), NOW), key).not.toThrow()
    }
  })

  test('logPresets hands out copies: editing one changes nothing', () => {
    const first = logPresets()
    first[2] = { key: 'x', label: 'x', filter: { search: 'edited' } }
    expect(logPresets()[2]?.key).toBe('network')
  })

  test('all keeps everything', () => {
    expect(kept(preset('all'))).toHaveLength(ENTRIES.length)
  })

  test('app-errors keeps the errors of app identities, and not the system’s', () => {
    expect(kept(preset('app-errors'))).toEqual([
      '[KeplerScript-JavaScript] player error tick 1',
      '[KeplerScript-JavaScript] fetch failed: TypeError: Network r'
    ])
  })

  test('network matches words in the message or tag, case-insensitively, whole words only', () => {
    expect(kept(preset('network'))).toEqual([
      // The service name in a message of the fixture counts: that is the preset's definition.
      'worker: dispatching LCM state update, service="com.amazon.ne',
      '[KeplerScript-JavaScript] fetch ok 200 https://example.com/',
      '[KeplerScript-JavaScript] fetch failed: TypeError: Network r',
      '[KeplerScript-JavaScript] XMLHttpRequest done',
      '[KeplerScript-JavaScript] request timeout after 5000 ms',
      'wifi link up',
      '[KeplerScript-JavaScript] SSL handshake ok'
    ])
  })

  test('network doesn’t match inside longer words', () => {
    const lines = kept(preset('network'))
    expect(lines.some((l) => l.includes('classloader'))).toBe(false)
  })

  test('lifecycle matches the lcm tags, lifecycle words and terminate', () => {
    expect(kept(preset('lifecycle'))).toEqual([
      "[LcmAppLaunchServiceImpl.cpp:347] Received request: 'launch ",
      '[Lcm.cpp:4371] Received launch request for orpheus://com.ama',
      '[AppStateChangeNotifier.cpp:197] no app state change monitor',
      "[LcmAppControlOpsSlimImpl.cpp:298] Received request: 'apps i",
      '[KeplerScript-JavaScript] GWSI_LOG Window 1 lifecycle state ',
      '[KeplerScript-JavaScript] app moved to background',
      '[Lcm.cpp:4412] Terminated app com.example.player'
    ])
  })
})

// Lines of the Virtual Device recording of a JS app (W1-T1), as the presets must read them.
describe('whole-word matching on Virtual Device lines', () => {
  const line = (identity: string, tag: string, message: string, i: number) =>
    `Nov 08 07:30:0${i}.100000 vvd-host local0.info ${identity}[500]: 600 INFO ${tag}: ${message}\n`
  const vvd = parseLines(
    [
      [
        'com.example.player',
        'com.amazon.keplerscript',
        '[KeplerScript-JavaScript] fetch start https://example.com/'
      ],
      [
        'com.example.player',
        'com.amazon.keplerscript',
        '[KeplerScript-JavaScript] fetch failed https://nonexistent.invalid/ TypeError: Network request failed'
      ],
      [
        'com.example.player',
        'com.amazon.keplerscript',
        '[KeplerScript-JavaScript] fetch ok https://example.com/ 200'
      ],
      // Not network: substrings of other words, and a setting that is not a timeout.
      ['lcm_service', 'LcmAppControlOpsSlimImpl', 'Received request: apps in foreground'],
      ['lcm_service', 'AppPssLogger', 'remove pid 26107 registry'],
      ['lcm_service', 'resmgr-x', 'poll interval timeout=0 ms'],
      // Lifecycle.
      ['lcm_service', 'lcm-server', 'Terminating package with id com.example.player without force'],
      [
        'lcm_service',
        'lcm-server',
        'appInst[62](com.example.player.main)<F>: Trigger event BACKGROUND in state VISIBLE. Completed: true'
      ],
      ['lcm_service', 'resmgr-y', 'Finished foreground transition, reason: 2']
    ]
      .map(([identity, tag, message], i) =>
        line(identity as string, tag as string, message as string, i)
      )
      .join('')
  )
  const ofPreset = (key: string) => {
    const filter = compileLogFilter(preset(key), NOW)
    return vvd.filter((e) => filter.matches(e)).map((e) => e.message)
  }

  test('network matches the fetch lines, and not LcmAppControlOpsSlimImpl, Pss or timeout=0', () => {
    expect(ofPreset('network')).toEqual([
      '[KeplerScript-JavaScript] fetch start https://example.com/',
      '[KeplerScript-JavaScript] fetch failed https://nonexistent.invalid/ TypeError: Network request failed',
      '[KeplerScript-JavaScript] fetch ok https://example.com/ 200'
    ])
    const network = compileLogFilter({ search: preset('network').search, regex: true }, NOW)
    const entry = (tag: string, message: string) =>
      ({ ...(vvd[0] as LogEntry), tag, message }) satisfies LogEntry
    expect(network.matches(entry('LcmAppControlOpsSlimImpl', 'x'))).toBe(false)
    expect(network.matches(entry('AppPssLogger', 'x'))).toBe(false)
    expect(network.matches(entry('t', 'timeout=0'))).toBe(false)
    expect(network.matches(entry('t', 'ssl'))).toBe(true)
    expect(network.matches(entry('t', 'a SSL error'))).toBe(true)
    expect(network.matches(entry('t', 'request timeout after 5 s'))).toBe(true)
    expect(network.matches(entry('t', 'timeout: 30'))).toBe(true)
  })

  test('lifecycle matches terminate, background and foreground lines, and the lcm tags', () => {
    expect(ofPreset('lifecycle')).toEqual([
      'Received request: apps in foreground',
      'Terminating package with id com.example.player without force',
      'appInst[62](com.example.player.main)<F>: Trigger event BACKGROUND in state VISIBLE. Completed: true',
      'Finished foreground transition, reason: 2'
    ])
  })
})

describe('resolvePreset', () => {
  const saved: SavedLogFilter[] = [
    { name: 'player-only', filter: { app: 'com.example.player', pid: [27178] } },
    { name: 'network', filter: { search: 'shadowed' } }
  ]

  test('resolves a built-in key, and a saved name', () => {
    expect(resolvePreset('app-errors')).toEqual({ level: 'error', appsOnly: true })
    expect(resolvePreset('player-only', saved)).toEqual({
      app: 'com.example.player',
      pid: [27178]
    })
  })

  test('a built-in key wins over a saved name', () => {
    expect(resolvePreset('network', saved).search).not.toBe('shadowed')
  })

  test('an unknown name is UNKNOWN_LOG_PRESET, and the hint lists the names', () => {
    let error: unknown
    try {
      resolvePreset('nope', saved)
    } catch (e) {
      error = e
    }
    expect(error).toMatchObject({
      code: 'UNKNOWN_LOG_PRESET',
      hint: 'Use one of all, app-errors, network, lifecycle, player-only, network'
    })
  })

  test('an unknown name is cut in the message', () => {
    expect(() => resolvePreset('x'.repeat(500))).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('x'.repeat(100)) })
    )
  })

  test('explicit fields override the preset’s, and arrays replace', () => {
    expect(resolvePreset('app-errors', [], { level: 'warn' })).toEqual({
      level: 'warn',
      appsOnly: true
    })
    expect(resolvePreset('player-only', saved, { pid: [1, 2] })).toEqual({
      app: 'com.example.player',
      pid: [1, 2]
    })
    expect(resolvePreset('player-only', saved, { pid: [] }).pid).toEqual([])
  })

  test('undefined overrides keep the preset’s value', () => {
    expect(resolvePreset('app-errors', [], { level: undefined })).toEqual({
      level: 'error',
      appsOnly: true
    })
  })

  test('--app or --system replaces the preset’s apps-only choice; with --app the preset still narrows', () => {
    const withApp = resolvePreset('app-errors', [], { app: 'com.example.player' })
    expect(withApp).toEqual({ level: 'error', app: 'com.example.player' })
    expect(() => compileLogFilter(withApp, NOW)).not.toThrow()
    const system = resolvePreset('app-errors', [], { system: true })
    expect(system).toEqual({ level: 'error', system: true })
    expect(() => compileLogFilter(system, NOW)).not.toThrow()
  })

  test('a new search replaces the preset’s search and its regex flag together', () => {
    expect(resolvePreset('network', [], { search: 'dns' })).toEqual({ search: 'dns' })
    expect(resolvePreset('network', [], { search: 'dns', regex: true })).toEqual({
      search: 'dns',
      regex: true
    })
  })

  test('the result is a copy: the preset and the saved filter stay as they were', () => {
    const merged = resolvePreset('player-only', saved, { level: 'info' })
    merged.pid?.push(9)
    expect(saved[0]?.filter).toEqual({ app: 'com.example.player', pid: [27178] })
    expect(resolvePreset('all')).toEqual({})
  })

  test('mergeLogFilter alone', () => {
    expect(mergeLogFilter({ level: 'error', tag: ['a'] }, { tag: ['b'], pid: [1] })).toEqual({
      level: 'error',
      tag: ['b'],
      pid: [1]
    })
  })
})
