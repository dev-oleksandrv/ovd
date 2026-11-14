import { describe, expect, test } from 'vitest'
import { compileLogFilter, type LogFilterInput } from '../../src/logs/logFilter.js'
import { createLogBuffer } from '../../src/logs/logBuffer.js'
import { createRateLimiter, secondOf } from '../../src/logs/processRules.js'
import { logText } from '../../src/logs/logText.js'
import type { LogEntry } from '../../src/logs/types.js'
import { logLine, parseLines } from './logLines.js'

const NOW = new Date('2026-11-08T12:00:00Z')
const PLAYER = 'com.example.player'
const OTHER = 'com.example.hellovega'

// `count` lines of one identity at 07:27:<second>, a millisecond apart.
function burst(identity: string, second: number, count: number, tag = 'flood'): string {
  return Array.from({ length: count }, (_, i) =>
    logLine({
      time: `07:27:${String(second).padStart(2, '0')}.${String(i * 10).padStart(3, '0')}000`,
      identity,
      message: `${tag} ${second}.${i}`
    })
  ).join('')
}

// What the user sees, one string per line: device lines by message, derived lines by text.
const view = (entries: LogEntry[]) => entries.map((e) => e.message)

function stream(input: LogFilterInput, entries: LogEntry[], batch = 1): LogEntry[] {
  const buffer = createLogBuffer(0, compileLogFilter(input, NOW))
  const out: LogEntry[] = []
  for (let i = 0; i < entries.length; i += batch)
    out.push(...buffer.add(entries.slice(i, i + batch)))
  return out
}

describe('createRateLimiter', () => {
  test('secondOf is the device-time second as ISO', () => {
    const [entry] = parseLines(logLine({ time: '07:27:03.999000', identity: PLAYER, message: 'x' }))
    expect(secondOf(entry as LogEntry)).toMatch(/^2026-11-08T07:27:03Z$/)
  })

  test('counts per identity and per second, and rolls when the device time moves on', () => {
    const limiter = createRateLimiter()
    const entries = parseLines(burst(PLAYER, 0, 4) + burst(OTHER, 0, 2) + burst(PLAYER, 1, 1))
    const verdicts = entries.map((entry) => {
      const lines = limiter.roll(entry)
      return { lines, ok: limiter.admit(entry, 2) }
    })
    expect(verdicts.map((v) => v.ok)).toEqual([true, true, false, false, true, true, true])
    const rolled = verdicts.flatMap((v) => v.lines)
    expect(rolled.map((l) => l.ovd)).toEqual([
      { kind: 'rate-limited', process: PLAYER, hidden: 2, second: '2026-11-08T07:27:00Z' }
    ])
    expect(limiter.flush()).toEqual([])
  })

  test('flush gives the lines of the seconds still open, once', () => {
    const limiter = createRateLimiter()
    for (const entry of parseLines(burst(PLAYER, 5, 5))) {
      limiter.roll(entry)
      limiter.admit(entry, 3)
    }
    const lines = limiter.flush()
    expect(lines.map((l) => l.message)).toEqual([`${PLAYER}: 2 lines hidden by rate limit`])
    expect(limiter.flush()).toEqual([])
  })

  test('a late line counts in the newest second: the clock never runs backwards', () => {
    const limiter = createRateLimiter()
    const [a, b, c] = parseLines(
      logLine({ time: '07:27:05.000000', identity: PLAYER, message: 'a' }) +
        logLine({ time: '07:27:04.000000', identity: PLAYER, message: 'b' }) +
        logLine({ time: '07:27:04.500000', identity: PLAYER, message: 'c' })
    ) as [LogEntry, LogEntry, LogEntry]
    const oks = [a, b, c].map((e) => (limiter.roll(e), limiter.admit(e, 1)))
    expect(oks).toEqual([true, false, false])
    expect(limiter.flush().map((l) => l.ovd)).toEqual([
      { kind: 'rate-limited', process: PLAYER, hidden: 2, second: '2026-11-08T07:27:05Z' }
    ])
  })

  test('a derived line shares the time and seq of the entry that closed the second', () => {
    const limiter = createRateLimiter()
    const entries = parseLines(burst(PLAYER, 0, 3) + burst(OTHER, 2, 1))
    let closed: LogEntry[] = []
    for (const entry of entries) {
      closed = [...closed, ...limiter.roll(entry)]
      limiter.admit(entry, 1)
    }
    const last = entries[entries.length - 1] as LogEntry
    expect(closed).toHaveLength(1)
    expect(closed[0]).toMatchObject({ seq: last.seq, time: last.time, tag: 'OVD', level: 'I' })
  })
})

describe('the evaluator', () => {
  const entries = parseLines(burst(PLAYER, 0, 5) + burst(OTHER, 0, 3) + burst(PLAYER, 1, 2))

  test('--process-rate shows at most N lines per second, with one line per hidden second', () => {
    const shown = stream({ processRules: [{ identity: PLAYER, rate: 2 }] }, entries)
    expect(view(shown)).toEqual([
      'flood 0.0',
      'flood 0.1',
      'flood 0.0',
      'flood 0.1',
      'flood 0.2',
      `${PLAYER}: 3 lines hidden by rate limit`,
      'flood 1.0',
      'flood 1.1'
    ])
  })

  test('a second that is still open reports nothing until the device time moves on or flush', () => {
    const buffer = createLogBuffer(
      0,
      compileLogFilter({ processRules: [{ identity: PLAYER, rate: 1 }] }, NOW)
    )
    const first = parseLines(burst(PLAYER, 0, 3))
    expect(buffer.add(first).map((e) => e.message)).toEqual(['flood 0.0'])
    // The same second still: nothing to report yet.
    expect(buffer.flush().map((e) => e.message)).toEqual([
      `${PLAYER}: 2 lines hidden by rate limit`
    ])
  })

  test('mute beats level and rate, and --process-level replaces the global level', () => {
    const lines = parseLines(
      logLine({ time: '07:27:00.100000', identity: PLAYER, message: 'info' }) +
        logLine({ time: '07:27:00.200000', identity: PLAYER, priority: 'err', message: 'err' }) +
        logLine({ time: '07:27:00.300000', identity: OTHER, message: 'other info' })
    )
    expect(
      view(
        stream({ processRules: [{ identity: PLAYER, mute: true, level: 'V', rate: 100 }] }, lines)
      )
    ).toEqual(['other info'])
    expect(
      view(stream({ level: 'error', processRules: [{ identity: PLAYER, level: 'I' }] }, lines))
    ).toEqual(['info', 'err'])
    expect(
      view(stream({ level: 'info', processRules: [{ identity: PLAYER, level: 'E' }] }, lines))
    ).toEqual(['err', 'other info'])
  })

  test('only lines that would be shown count toward the rate', () => {
    // The info lines are filtered by --level; the two errors fit the rate of 2.
    const lines = parseLines(
      burst(PLAYER, 0, 4) +
        logLine({ time: '07:27:00.900000', identity: PLAYER, priority: 'err', message: 'e1' }) +
        logLine({ time: '07:27:00.950000', identity: PLAYER, priority: 'err', message: 'e2' })
    )
    const shown = stream({ level: 'error', processRules: [{ identity: PLAYER, rate: 2 }] }, lines)
    expect(view(shown)).toEqual(['e1', 'e2'])
  })

  test('OVD lines in the stream are shown and don’t count', () => {
    const ovd = { ...(entries[0] as LogEntry), ovd: { kind: 'reconnected' as const }, message: 'x' }
    const shown = stream({ processRules: [{ identity: PLAYER, rate: 1 }] }, [
      ovd,
      ...entries.slice(0, 2)
    ])
    expect(view(shown)).toEqual(['x', 'flood 0.0'])
  })

  test('the human line escapes nothing it needs to: identities are validated text', () => {
    const shown = stream({ processRules: [{ identity: PLAYER, rate: 1 }] }, entries)
    const line = shown.find((e) => e.ovd?.kind === 'rate-limited') as LogEntry
    expect(logText(line)).toMatch(/OVD com\.example\.player: 4 lines hidden by rate limit\n$/)
  })
})

describe('the same output streamed and re-filtered', () => {
  const entries = parseLines(
    burst(PLAYER, 0, 6) +
      burst(OTHER, 0, 4, 'other') +
      burst(PLAYER, 1, 3) +
      burst(OTHER, 1, 2, 'other') +
      burst(PLAYER, 3, 4) +
      burst(OTHER, 4, 5, 'other')
  )
  const input: LogFilterInput = {
    processRules: [
      { identity: PLAYER, rate: 2 },
      { identity: OTHER, rate: 3 }
    ]
  }

  test('setFilter over the buffer equals streaming, derived lines included', () => {
    const filter = compileLogFilter(input, NOW)
    const streamed = createLogBuffer(100, filter)
    for (const entry of entries) streamed.add([entry])
    // A buffer that first held everything, then got the filter.
    const refiltered = createLogBuffer(100)
    refiltered.add(entries)
    refiltered.setFilter(filter)
    expect(view(refiltered.filtered())).toEqual(view(streamed.filtered()))
    expect(refiltered.counts()).toEqual(streamed.counts())
    // The derived lines are in the output, not stored in the buffer.
    expect(refiltered.filtered().some((e) => e.ovd?.kind === 'rate-limited')).toBe(true)
    expect(refiltered.counts().lines).toBe(entries.length)
  })

  test('the result doesn’t depend on how the entries are batched', () => {
    const whole = stream(input, entries, entries.length)
    const single = stream(input, entries, 1)
    const batches = stream(input, entries, 7)
    expect(view(single)).toEqual(view(whole))
    expect(view(batches)).toEqual(view(whole))
  })

  test('re-filtering twice, or to another filter and back, gives the same list', () => {
    const buffer = createLogBuffer(100)
    buffer.add(entries)
    const filter = compileLogFilter(input, NOW)
    buffer.setFilter(filter)
    const first = view(buffer.filtered())
    buffer.setFilter(compileLogFilter({ processRules: [{ identity: PLAYER, mute: true }] }, NOW))
    expect(view(buffer.filtered()).every((m) => !m.startsWith('flood'))).toBe(true)
    buffer.setFilter(filter)
    expect(view(buffer.filtered())).toEqual(first)
  })

  test('flushed lines are the same as a stream that was flushed at the end', () => {
    const filter = compileLogFilter(input, NOW)
    const streamed = createLogBuffer(100, filter)
    for (const entry of entries) streamed.add([entry])
    streamed.flush()
    const refiltered = createLogBuffer(100)
    refiltered.add(entries)
    refiltered.flush()
    refiltered.setFilter(filter)
    expect(view(refiltered.filtered())).toEqual(view(streamed.filtered()))
    expect(view(streamed.filtered()).at(-1)).toBe(`${OTHER}: 2 lines hidden by rate limit`)
  })
})
