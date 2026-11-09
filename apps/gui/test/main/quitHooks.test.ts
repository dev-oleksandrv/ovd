// @vitest-environment node
import { EventEmitter } from 'node:events'
import { describe, expect, test, vi } from 'vitest'
import { registerQuitHooks, type QuittingApp } from '../../src/main/quitHooks'

class FakeApp extends EventEmitter implements QuittingApp {
  quits = 0
  quit(): void {
    this.quits++
  }
}

function quitEvent() {
  return { preventDefault: vi.fn() }
}

function fakeLogs(running: boolean) {
  let finish = (): void => undefined
  const stopped = new Promise<void>((resolve) => (finish = resolve))
  return {
    running: vi.fn(() => running),
    stop: vi.fn(() => stopped),
    finish
  }
}

describe('registerQuitHooks', () => {
  test('before-quit aborts the signal the Doctor run gets', async () => {
    const app = new FakeApp()
    const quitting = registerQuitHooks(app, { logs: fakeLogs(false), stopAll: vi.fn() })
    const run = new Promise((_, reject) => {
      quitting.addEventListener('abort', () => {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        reject(error)
      })
    })
    expect(quitting.aborted).toBe(false)

    app.emit('before-quit', quitEvent())

    expect(quitting.aborted).toBe(true)
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('before-quit with a running log session waits for it to stop, then quits', async () => {
    const app = new FakeApp()
    const logs = fakeLogs(true)
    registerQuitHooks(app, { logs, stopAll: vi.fn() })
    const first = quitEvent()

    app.emit('before-quit', first)

    expect(first.preventDefault).toHaveBeenCalledTimes(1)
    expect(logs.stop).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(app.quits).toBe(0)
    logs.finish()
    await vi.waitFor(() => expect(app.quits).toBe(1))

    const second = quitEvent()
    app.emit('before-quit', second)
    expect(second.preventDefault).not.toHaveBeenCalled()
  })

  test('before-quit without a log session lets the quit go on', () => {
    const app = new FakeApp()
    registerQuitHooks(app, { logs: fakeLogs(false), stopAll: vi.fn() })
    const event = quitEvent()

    app.emit('before-quit', event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(app.quits).toBe(0)
  })

  test('will-quit calls stopAll', () => {
    const app = new FakeApp()
    const stopAll = vi.fn()
    registerQuitHooks(app, { logs: fakeLogs(false), stopAll })

    app.emit('will-quit')

    expect(stopAll).toHaveBeenCalledTimes(1)
  })
})
