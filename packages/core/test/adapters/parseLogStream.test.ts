import { describe, expect, test } from 'vitest'
import { createLogStreamParser } from '../../src/adapters/parseLogStream.js'
import type { LogEntry } from '../../src/logs/types.js'
import { fixture } from '../support/fixtures.js'

const NOW = new Date('2026-11-08T12:00:00Z')
const now = () => NOW

const FOLLOW = fixture('0.24/loggingctl-log/stick-follow.txt')
const DEBUG_STACK = fixture('0.24/loggingctl-log/stick-follow-debug-stack.txt')
const RATE_LIMIT = fixture('0.24/loggingctl-log/stick-follow-rate-limit.txt')
const REBOOT = fixture('0.24/loggingctl-log/stick-follow-reboot.txt')

function parseAll(chunks: string[]): LogEntry[] {
  const parser = createLogStreamParser({ now })
  return [...chunks.flatMap((c) => parser.push(c)), ...parser.end()]
}

// The entry whose first line is the fixture's line `n` (1-based).
function entryAt(text: string, n: number): LogEntry {
  const lines = text.split('\n')
  const first = lines[n - 1] ?? ''
  const found = parseAll([text]).find((e) => first.endsWith(e.message.split('\n')[0] ?? '\u0000'))
  if (!found) throw new Error(`no entry for line ${n}`)
  return found
}

describe('createLogStreamParser', () => {
  test.each([
    ['stick-follow.txt', FOLLOW, 243],
    ['stick-follow-debug-stack.txt', DEBUG_STACK, 33],
    ['stick-follow-rate-limit.txt', RATE_LIMIT, 21],
    ['stick-follow-reboot.txt', REBOOT, 20]
  ])('%s: one entry per header line, every one parsed', (_name, text, count) => {
    const entries = parseAll([text])
    expect(entries).toHaveLength(count)
    expect(entries.every((e) => e.parsed)).toBe(true)
    expect(entries.map((e) => e.seq)).toEqual(entries.map((_, i) => i))
  })

  test('a multi-line message keeps its continuation lines', () => {
    const multi = parseAll([FOLLOW]).find((e) => e.message.includes('player multi'))
    expect(multi).toMatchObject({
      message: '[KeplerScript-JavaScript] player multi\nline two\nline three',
      process: 'com.example.player',
      tag: 'com.amazon.keplerscript',
      level: 'I'
    })
  })

  test('the Volta entry carries the 8 stack lines that follow it', () => {
    const volta = entryAt(FOLLOW, 37)
    expect(volta.tag).toBe('Volta')
    expect(volta.level).toBe('W')
    const lines = volta.message.split('\n')
    expect(lines[0]).toBe('Volta:console.error: player error tick 1')
    expect(lines.slice(1)).toEqual(FOLLOW.split('\n').slice(37, 45))
  })

  test('the JS stack of a Debug build stays with its entry', () => {
    const volta = entryAt(DEBUG_STACK, 5)
    expect(volta.message.split('\n')).toHaveLength(12)
    expect(volta.message).toContain('at anonymous (/private/tmp/player/build/lib/rn-bundles/Debug/')
  })

  test.each([
    [
      'an ACE line',
      FOLLOW,
      3,
      {
        level: 'E',
        priority: 'err',
        facility: 'local0',
        process: 'lcm_service',
        pid: 899,
        tid: 1166,
        tag: 'resmgr-app-registry',
        message: '[AppResourceRegistry.cpp:604] Removing 983:26107',
        deviceTime: 'Nov 08 07:26:59.934822',
        time: '2026-11-08T07:26:59.934Z'
      }
    ],
    [
      'an app line with a tid and INFO',
      FOLLOW,
      35,
      {
        level: 'E',
        process: 'com.example.player',
        pid: 27178,
        tid: 2842092448,
        tag: 'com.amazon.keplerscript',
        message: '[KeplerScript-JavaScript] player error tick 1'
      }
    ],
    [
      'a journald line without a tid',
      FOLLOW,
      96,
      {
        process: 'userprofilemanager-server',
        pid: 902,
        tid: null,
        tag: 'userprofilemanager-server',
        facility: 'daemon',
        message: 'service: client: ID 154'
      }
    ],
    [
      'a journald line with a bracketed level',
      RATE_LIMIT,
      16,
      { process: 'comet_main', pid: 2658, tid: null, tag: 'comet_main' }
    ],
    [
      'the rate-limit notice',
      RATE_LIMIT,
      10,
      {
        level: 'W',
        process: 'com.example.player',
        tag: 'apmf.core.logconfig.config_monitor'
      }
    ],
    [
      'a tag glued to its message',
      DEBUG_STACK,
      17,
      { process: 'powerd', tid: 1346, tag: 'ACE_MW_POWER' }
    ],
    [
      'systemd without a level word',
      REBOOT,
      20,
      {
        process: 'systemd',
        pid: 1,
        tid: 1,
        tag: 'systemd',
        message: 'Starting Gracefull reboot for the device....'
      }
    ]
  ])('%s', (_name, text, line, expected) => {
    expect(entryAt(text, line)).toMatchObject(expected)
  })

  test.each([
    ['stick-follow.txt', FOLLOW],
    ['stick-follow-debug-stack.txt', DEBUG_STACK],
    ['stick-follow-rate-limit.txt', RATE_LIMIT],
    ['stick-follow-reboot.txt', REBOOT]
  ])('%s split at every byte gives the same entries as one chunk', (_name, text) => {
    expect(parseAll(text.split(''))).toEqual(parseAll([text]))
  })

  test('split mid-header and mid-continuation gives the same entries', () => {
    const header = FOLLOW.indexOf('Nov 08 07:27:01.260754') + 10
    const continuation = FOLLOW.indexOf('line two') + 4
    const chunks = [
      FOLLOW.slice(0, header),
      FOLLOW.slice(header, continuation),
      FOLLOW.slice(continuation)
    ]
    expect(parseAll(chunks)).toEqual(parseAll([FOLLOW]))
  })

  test('an entry is held until the next header or a flush', () => {
    const parser = createLogStreamParser({ now })
    const [first = '', second = ''] = FOLLOW.split('\n')
    expect(parser.push(`${first}\n`)).toEqual([])
    expect(parser.push(`${second}\n`)).toHaveLength(1)
    expect(parser.flush()).toMatchObject([{ process: 'lcm_service', tid: 1166 }])
    expect(parser.flush()).toEqual([])
  })

  test('a continuation after a flush becomes an entry like the one it follows', () => {
    const parser = createLogStreamParser({ now })
    const header = FOLLOW.split('\n')[195] ?? ''
    parser.push(`${header}\n`)
    const [flushed] = parser.flush()
    parser.push('line two\n')
    const [late] = parser.end()
    expect(late).toMatchObject({
      time: flushed?.time,
      deviceTime: flushed?.deviceTime,
      process: 'com.example.player',
      pid: 27178,
      tag: 'com.amazon.keplerscript',
      message: 'line two',
      seq: 1
    })
  })

  test('a leading line without a header is kept as an unparsed entry', () => {
    const entries = parseAll([`--- leftover\n${REBOOT}`])
    expect(entries).toHaveLength(21)
    expect(entries[0]).toEqual({
      seq: 0,
      time: NOW.toISOString(),
      deviceTime: null,
      level: 'I',
      priority: null,
      facility: null,
      process: null,
      pid: null,
      tid: null,
      tag: '',
      message: '--- leftover',
      parsed: false
    })
  })

  test('an unknown priority is level I and keeps the priority as printed', () => {
    const [entry] = parseAll([
      'Nov 08 07:27:00.257342 firestick-0000000000000001 local0.chatty com.example.player[27178]: 1 hi\n'
    ])
    expect(entry).toMatchObject({ level: 'I', priority: 'chatty', message: 'hi' })
  })

  test('a header whose rest has no identity keeps the rest as the message', () => {
    const [entry] = parseAll([
      'Nov 08 07:27:00.257342 firestick-0000000000000001 kern.info -- MARK --\n'
    ])
    expect(entry).toMatchObject({ process: null, pid: null, tid: null, message: '-- MARK --' })
  })

  test('escape sequences and carriage returns are stripped', () => {
    const [entry] = parseAll([
      'Nov 08 07:27:00.257342 firestick-0000000000000001 local0.info com.example.player[27178]: 1 I tag: \u001b[31mred\u001b[0m\r\n'
    ])
    expect(entry?.message).toBe('[31mred[0m')
  })

  test('an unfinished last line is taken at the end', () => {
    const parser = createLogStreamParser({ now })
    const line = REBOOT.split('\n')[19] ?? ''
    expect(parser.push(line)).toEqual([])
    expect(parser.flush()).toEqual([])
    expect(parser.end()).toMatchObject([{ process: 'systemd' }])
  })
})
