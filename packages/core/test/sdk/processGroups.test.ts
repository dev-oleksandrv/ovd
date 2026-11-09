import { describe, expect, test } from 'vitest'
import { createProcessGroups } from '../../src/sdk/processGroups.js'

// A fake `kill`: a real `kill(-pid)` on a reused pid could hit an unrelated group.
function fakeKill(fail: (pid: number) => Error | undefined = () => undefined) {
  const calls: [number, NodeJS.Signals][] = []
  const kill = (pid: number, signal: NodeJS.Signals): void => {
    calls.push([pid, signal])
    const error = fail(pid)
    if (error) throw error
  }
  return { calls, kill }
}

function errno(code: string): Error {
  return Object.assign(new Error(code), { code })
}

describe('createProcessGroups', () => {
  test('register adds a group, and its unregister removes only that registration, once', () => {
    const groups = createProcessGroups(fakeKill().kill)
    const first = groups.register(101)
    groups.register(101)
    groups.register(202)

    first()
    first()

    expect(groups.pids()).toEqual([101, 202])
  })

  test('stopAll sends SIGTERM to every registered group', () => {
    const { calls, kill } = fakeKill()
    const groups = createProcessGroups(kill)
    groups.register(101)
    groups.register(202)

    groups.stopAll()

    expect(calls).toEqual([
      [-101, 'SIGTERM'],
      [-202, 'SIGTERM']
    ])
  })

  test('stopAll swallows ESRCH, EPERM and any other error per group, and still signals the rest', () => {
    const errors = new Map<number, Error>([
      [-101, errno('ESRCH')],
      [-202, errno('EPERM')],
      [-303, new Error('boom')]
    ])
    const { calls, kill } = fakeKill((pid) => errors.get(pid))
    const groups = createProcessGroups(kill)
    groups.register(101)
    groups.register(202)
    groups.register(303)

    expect(() => groups.stopAll()).not.toThrow()

    expect(calls.map(([pid]) => pid)).toEqual([-101, -202, -303])
  })

  test('stopAll leaves the registrations to their runs', () => {
    const groups = createProcessGroups(fakeKill().kill)
    groups.register(101)
    groups.register(202)

    groups.stopAll()

    expect(groups.pids()).toEqual([101, 202])
  })
})
