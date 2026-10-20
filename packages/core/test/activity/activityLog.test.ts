import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { createActivityLog } from '../../src/index.js'

let home: string
const now = () => new Date('2026-10-20T15:00:00.000Z')
const entry = {
  action: 'target.set',
  target: 'VirtualDevice',
  args: {},
  result: 'ok'
} as const

beforeEach(async () => {
  home = join(await mkdtemp(join(tmpdir(), 'ovd-activity-')), 'ovd')
})

const lines = async (file: string) =>
  (await readFile(join(home, file), 'utf8')).split('\n').filter((l) => l !== '')

describe('createActivityLog', () => {
  test('appends one JSON line with time and surface, creating the directory', async () => {
    await createActivityLog({ home, surface: 'cli', now }).append(entry)
    expect(await lines('activity.jsonl')).toEqual([
      '{"time":"2026-10-20T15:00:00.000Z","surface":"cli","action":"target.set","target":"VirtualDevice","args":{},"result":"ok"}'
    ])
  })

  test('records errorCode only when given', async () => {
    const log = createActivityLog({ home, surface: 'desktop', now })
    await log.append({ ...entry, result: 'error', errorCode: 'TARGET_OFFLINE' })
    await log.append(entry)
    const [failed, ok] = (await lines('activity.jsonl')).map((l) => JSON.parse(l) as object)
    expect(failed).toMatchObject({ result: 'error', errorCode: 'TARGET_OFFLINE' })
    expect(ok).not.toHaveProperty('errorCode')
  })

  test('rotates past maxBytes and keeps a single backup', async () => {
    const log = createActivityLog({ home, surface: 'cli', now, maxBytes: 200 })
    await log.append({ ...entry, args: { n: 1 } })
    await log.append({ ...entry, args: { n: 2 } })
    await log.append({ ...entry, args: { n: 3 } })
    expect((await lines('activity.1.jsonl')).map((l) => JSON.parse(l).args.n)).toEqual([1, 2])
    expect((await lines('activity.jsonl')).map((l) => JSON.parse(l).args.n)).toEqual([3])

    await log.append({ ...entry, args: { n: 4 } })
    await log.append({ ...entry, args: { n: 5 } })
    expect((await lines('activity.1.jsonl')).map((l) => JSON.parse(l).args.n)).toEqual([3, 4])
    expect((await lines('activity.jsonl')).map((l) => JSON.parse(l).args.n)).toEqual([5])
  })

  test('concurrent appends from two surfaces keep every line intact', async () => {
    const cli = createActivityLog({ home, surface: 'cli', now })
    const desktop = createActivityLog({ home, surface: 'desktop', now })
    await Promise.all(
      Array.from({ length: 50 }, (_, n) => [
        cli.append({ ...entry, args: { n } }),
        desktop.append({ ...entry, args: { n } })
      ]).flat()
    )
    const parsed = (await lines('activity.jsonl')).map((l) => JSON.parse(l) as { surface: string })
    expect(parsed).toHaveLength(100)
    expect(parsed.filter((e) => e.surface === 'cli')).toHaveLength(50)
  })
})
