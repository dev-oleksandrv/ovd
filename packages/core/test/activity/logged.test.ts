import { describe, expect, test } from 'vitest'
import { OvdError, type ActivityEntry, type ActivityLog } from '../../src/index.js'
import { createLogged } from '../../src/activity/logged.js'

function memoryLog() {
  const entries: Omit<ActivityEntry, 'time' | 'surface'>[] = []
  const log: ActivityLog = {
    async append(entry) {
      entries.push(entry)
    }
  }
  return { entries, logged: createLogged(log) }
}

describe('createLogged', () => {
  test('a resolved run: one ok entry, and the value', async () => {
    const { entries, logged } = memoryLog()

    const value = await logged('app.launch', 'VirtualDevice', { app: 'com.example.player' }, () =>
      Promise.resolve(42)
    )

    expect(value).toBe(42)
    expect(entries).toEqual([
      {
        action: 'app.launch',
        target: 'VirtualDevice',
        args: { app: 'com.example.player' },
        result: 'ok'
      }
    ])
  })

  test('a thrown OvdError: one error entry with its code, and the error', async () => {
    const { entries, logged } = memoryLog()
    const error = new OvdError('LAUNCH_FAILED', 'Launch failed: boom', 'Retry')

    await expect(
      logged('app.launch', 'VirtualDevice', { app: 'com.example.player' }, () =>
        Promise.reject(error)
      )
    ).rejects.toBe(error)

    expect(entries).toEqual([
      {
        action: 'app.launch',
        target: 'VirtualDevice',
        args: { app: 'com.example.player' },
        result: 'error',
        errorCode: 'LAUNCH_FAILED'
      }
    ])
  })

  test('a returned failure: one error entry with the merged args, and the value', async () => {
    const { entries, logged } = memoryLog()
    const result = { verified: false, pid: 3200 }

    const value = await logged(
      'app.launch',
      'VirtualDevice',
      { app: 'com.example.player' },
      () => Promise.resolve(result),
      (r) =>
        r.verified
          ? undefined
          : { errorCode: 'LAUNCH_NOT_VERIFIED', args: { reason: 'crashed', pid: String(r.pid) } }
    )

    expect(value).toBe(result)
    expect(entries).toEqual([
      {
        action: 'app.launch',
        target: 'VirtualDevice',
        args: { app: 'com.example.player', reason: 'crashed', pid: '3200' },
        result: 'error',
        errorCode: 'LAUNCH_NOT_VERIFIED'
      }
    ])
  })

  test('an outcome that sees nothing wrong: ok', async () => {
    const { entries, logged } = memoryLog()

    await logged(
      'app.launch',
      'VirtualDevice',
      {},
      () => Promise.resolve(1),
      () => undefined
    )

    expect(entries).toMatchObject([{ result: 'ok' }])
  })

  test('a throw that isn’t an OvdError (an abort): not logged', async () => {
    const { entries, logged } = memoryLog()
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'

    await expect(logged('app.launch', null, {}, () => Promise.reject(abort))).rejects.toBe(abort)

    expect(entries).toEqual([])
  })
})
