import { appendFile, mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createActivityLog, type ActivityEntry } from '../../src/index.js'
import { ACTIVITY_POLL_MS, createActivityFeed } from '../../src/activity/activityFeed.js'

let home: string
const file = () => join(home, 'activity.jsonl')
const log = () => createActivityLog({ home, surface: 'cli' })
const install = (target: string) =>
  ({ action: 'app.install', target, args: { package: 'player_armv7.vpkg' }, result: 'ok' }) as const

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'ovd-feed-'))
  // setImmediate stays real: the feed reads files while the clock is fake.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(home, { recursive: true, force: true })
})

const settle = () => new Promise<void>((resolve) => setImmediate(resolve))
const WAIT_BUDGET_NS = 5_000_000_000n

// Real time, read from `process.hrtime`, which the fake timers leave alone: the polls do real
// file I/O.
async function waitFor(condition: () => boolean): Promise<void> {
  const started = process.hrtime.bigint()
  while (process.hrtime.bigint() - started < WAIT_BUDGET_NS) {
    if (condition()) return
    await settle()
  }
  if (condition()) return
  throw new Error('waitFor: condition never held')
}

// Runs polls until `condition` holds.
async function pollUntil(condition: () => boolean): Promise<void> {
  const started = process.hrtime.bigint()
  while (process.hrtime.bigint() - started < WAIT_BUDGET_NS) {
    if (condition()) return
    await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_MS)
    await settle()
  }
  if (condition()) return
  throw new Error('pollUntil: condition never held')
}

// Runs a few polls, for checks that nothing arrives.
async function somePolls(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_MS)
    for (let j = 0; j < 20; j++) await settle()
  }
}

describe('createActivityFeed', () => {
  test('delivers only entries appended after the first subscriber', async () => {
    await log().append(install('before'))
    const feed = createActivityFeed({ home })
    const seen: ActivityEntry[] = []
    const off = feed.subscribe((e) => seen.push(e))
    await log().append(install('A'))
    await log().append(install('B'))
    await pollUntil(() => seen.length === 2)
    expect(seen.map((e) => e.target)).toEqual(['A', 'B'])
    expect(seen[0]).toMatchObject({ surface: 'cli', action: 'app.install', result: 'ok' })
    off()
  })

  test('a partial last line waits for its newline', async () => {
    const feed = createActivityFeed({ home })
    await log().append(install('first'))
    const seen: ActivityEntry[] = []
    const off = feed.subscribe((e) => seen.push(e))
    const line = JSON.stringify({
      ...install('split'),
      time: new Date().toISOString(),
      surface: 'desktop'
    })
    await appendFile(file(), line.slice(0, 20))
    await somePolls()
    expect(seen).toEqual([])
    await appendFile(file(), `${line.slice(20)}\n`)
    await pollUntil(() => seen.length === 1)
    expect(seen[0]).toMatchObject({ target: 'split', surface: 'desktop' })
    off()
  })

  test('an invalid line is skipped', async () => {
    const feed = createActivityFeed({ home })
    await log().append(install('first'))
    const seen: ActivityEntry[] = []
    const off = feed.subscribe((e) => seen.push(e))
    const time = new Date().toISOString()
    await appendFile(
      file(),
      [
        'not json',
        JSON.stringify({ time, surface: 'cli', action: 'app.install' }),
        JSON.stringify({ ...install('x'), time, surface: 'cli', action: 'app.explode' }),
        ''
      ].join('\n')
    )
    await log().append(install('valid'))
    await pollUntil(() => seen.length > 0)
    await somePolls()
    expect(seen.map((e) => e.target)).toEqual(['valid'])
    off()
  })

  test('after a rotation it reads the new file from the start', async () => {
    await log().append(install('old 1'))
    await log().append(install('old 2'))
    const feed = createActivityFeed({ home })
    const seen: ActivityEntry[] = []
    const off = feed.subscribe((e) => seen.push(e))
    await rename(file(), join(home, 'activity.1.jsonl'))
    await somePolls()
    await log().append(install('new'))
    await pollUntil(() => seen.length === 1)
    expect(seen.map((e) => e.target)).toEqual(['new'])
    off()
  })

  test('a missing file is empty, not an error', async () => {
    const feed = createActivityFeed({ home: join(home, 'nested') })
    const seen: ActivityEntry[] = []
    const off = feed.subscribe((e) => seen.push(e))
    await somePolls()
    expect(seen).toEqual([])
    await createActivityLog({ home: join(home, 'nested'), surface: 'cli' }).append(install('A'))
    await pollUntil(() => seen.length === 1)
    off()
  })

  test('the last unsubscribe stops polling', async () => {
    const feed = createActivityFeed({ home })
    const seen: ActivityEntry[] = []
    const offA = feed.subscribe((e) => seen.push(e))
    const offB = feed.subscribe(() => undefined)
    offA()
    expect(vi.getTimerCount()).toBe(1)
    offB()
    expect(vi.getTimerCount()).toBe(0)
    await log().append(install('late'))
    await somePolls()
    await waitFor(() => vi.getTimerCount() === 0)
    expect(seen).toEqual([])
  })

  test('two subscribers both get each entry', async () => {
    const feed = createActivityFeed({ home })
    const a: ActivityEntry[] = []
    const b: ActivityEntry[] = []
    const offA = feed.subscribe((e) => a.push(e))
    const offB = feed.subscribe((e) => b.push(e))
    await log().append(install('A'))
    await log().append(install('B'))
    await pollUntil(() => a.length === 2 && b.length === 2)
    expect(a).toEqual(b)
    offA()
    offB()
  })

  test('an entry with an arg longer than 4096 characters is skipped', async () => {
    const feed = createActivityFeed({ home })
    await log().append(install('first'))
    const seen: ActivityEntry[] = []
    const off = feed.subscribe((e) => seen.push(e))
    const time = new Date().toISOString()
    await appendFile(
      file(),
      `${JSON.stringify({ ...install('long'), args: { package: 'p'.repeat(4097) }, time, surface: 'cli' })}\n`
    )
    await log().append(install('valid'))
    await pollUntil(() => seen.length > 0)
    await somePolls()
    expect(seen.map((e) => e.target)).toEqual(['valid'])
    off()
  })

  test('a 3 MiB append is read over several polls, each entry once', async () => {
    const feed = createActivityFeed({ home })
    await log().append(install('first'))
    const seen: ActivityEntry[] = []
    const off = feed.subscribe((e) => seen.push(e))
    const time = new Date().toISOString()
    const lines: string[] = []
    let bytes = 0
    for (let i = 0; bytes < 3 * 1024 * 1024; i++) {
      // A multi-byte character, so chunk edges fall inside one now and then.
      const line = `${JSON.stringify({ ...install(`T${i}`), args: { package: `pläyer_${'x'.repeat(200)}.vpkg` }, time, surface: 'cli' })}\n`
      lines.push(line)
      bytes += Buffer.byteLength(line)
    }
    await appendFile(file(), lines.join(''))
    await pollUntil(() => seen.length > 0)
    expect(seen.length).toBeLessThan(lines.length)
    await pollUntil(() => seen.length >= lines.length)
    await somePolls()
    expect(seen.map((e) => e.target)).toEqual(lines.map((_, i) => `T${i}`))
    off()
  })

  test('an unterminated line over 64 KiB is dropped up to its newline', async () => {
    const feed = createActivityFeed({ home })
    await log().append(install('first'))
    const seen: ActivityEntry[] = []
    const off = feed.subscribe((e) => seen.push(e))
    const time = new Date().toISOString()
    // JSON allows leading spaces: kept whole, this line would parse as the 'dropped' entry.
    await appendFile(file(), ' '.repeat(80 * 1024))
    await somePolls()
    await appendFile(file(), `${JSON.stringify({ ...install('dropped'), time, surface: 'cli' })}\n`)
    await log().append(install('valid'))
    await pollUntil(() => seen.length > 0)
    await somePolls()
    expect(seen.map((e) => e.target)).toEqual(['valid'])
    off()
  })
})
