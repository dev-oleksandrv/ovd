import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import { installExitHooks } from '../src/exitHooks.js'

function fakeProcess() {
  const proc = Object.assign(new EventEmitter(), {
    exit: vi.fn<(code: number) => void>(),
    stdout: new EventEmitter()
  })
  return proc
}

function epipe(): NodeJS.ErrnoException {
  return Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })
}

describe('installExitHooks', () => {
  test('exit calls stopAll', () => {
    const proc = fakeProcess()
    const stopAll = vi.fn()
    installExitHooks(proc, stopAll)

    proc.emit('exit')

    expect(stopAll).toHaveBeenCalledTimes(1)
  })

  test('SIGTERM calls stopAll, then exits 143', () => {
    const proc = fakeProcess()
    const order: string[] = []
    const stopAll = vi.fn(() => order.push('stopAll'))
    proc.exit.mockImplementation((code) => order.push(`exit ${code}`))
    installExitHooks(proc, stopAll)

    proc.emit('SIGTERM')

    expect(order).toEqual(['stopAll', 'exit 143'])
  })

  test('SIGHUP calls stopAll, then exits 129', () => {
    const proc = fakeProcess()
    const order: string[] = []
    const stopAll = vi.fn(() => order.push('stopAll'))
    proc.exit.mockImplementation((code) => order.push(`exit ${code}`))
    installExitHooks(proc, stopAll)

    proc.emit('SIGHUP')

    expect(order).toEqual(['stopAll', 'exit 129'])
  })

  test("the first SIGINT calls the command's abort only", () => {
    const proc = fakeProcess()
    const stopAll = vi.fn()
    const abort = vi.fn()
    installExitHooks(proc, stopAll).onInterrupt(abort)

    proc.emit('SIGINT')

    expect(abort).toHaveBeenCalledTimes(1)
    expect(stopAll).not.toHaveBeenCalled()
    expect(proc.exit).not.toHaveBeenCalled()
  })

  test('a second SIGINT calls stopAll and exits 130', () => {
    const proc = fakeProcess()
    const order: string[] = []
    const stopAll = vi.fn(() => order.push('stopAll'))
    proc.exit.mockImplementation((code) => order.push(`exit ${code}`))
    const abort = vi.fn()
    installExitHooks(proc, stopAll).onInterrupt(abort)

    proc.emit('SIGINT')
    proc.emit('SIGINT')

    expect(abort).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['stopAll', 'exit 130'])
  })

  test('SIGINT with no command listening calls stopAll and exits 130', () => {
    const before = fakeProcess()
    const stopBefore = vi.fn()
    installExitHooks(before, stopBefore)
    before.emit('SIGINT')
    expect(stopBefore).toHaveBeenCalledTimes(1)
    expect(before.exit).toHaveBeenCalledWith(130)

    const after = fakeProcess()
    const stopAfter = vi.fn()
    const abort = vi.fn()
    const dispose = installExitHooks(after, stopAfter).onInterrupt(abort)
    dispose()
    after.emit('SIGINT')
    expect(abort).not.toHaveBeenCalled()
    expect(stopAfter).toHaveBeenCalledTimes(1)
    expect(after.exit).toHaveBeenCalledWith(130)
  })

  test('a closed stdout pipe aborts like the first Ctrl+C and never forces an exit', () => {
    const proc = fakeProcess()
    const stopAll = vi.fn()
    const abort = vi.fn()
    installExitHooks(proc, stopAll).onInterrupt(abort)

    proc.stdout.emit('error', Object.assign(new Error('other'), { code: 'EBADF' }))
    expect(abort).not.toHaveBeenCalled()

    proc.stdout.emit('error', epipe())
    proc.stdout.emit('error', epipe())
    expect(abort).toHaveBeenCalledTimes(1)
    expect(stopAll).not.toHaveBeenCalled()
    expect(proc.exit).not.toHaveBeenCalled()

    proc.emit('SIGINT')
    expect(abort).toHaveBeenCalledTimes(1)
    expect(stopAll).toHaveBeenCalledTimes(1)
    expect(proc.exit).toHaveBeenCalledWith(130)
  })

  test('dispose removes the stdout error listener', () => {
    const proc = fakeProcess()
    const dispose = installExitHooks(proc, vi.fn()).onInterrupt(vi.fn())
    expect(proc.stdout.listenerCount('error')).toBe(1)

    dispose()

    expect(proc.stdout.listenerCount('error')).toBe(0)
  })
})
