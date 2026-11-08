import { expect, test, vi } from 'vitest'
import { createSerialRunner, type CommandSpec, type Runner } from '../../src/index.js'

const spec = (display: string): CommandSpec => ({ file: 'vega', args: [], display })

test('runs one SDK command at a time, in call order, and keeps going after a failure', async () => {
  let active = 0
  let peak = 0
  const order: string[] = []
  const inner: Runner = {
    async run(s) {
      active++
      peak = Math.max(peak, active)
      order.push(s.display)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      if (s.display === 'b') throw new Error('b failed')
      return { stdout: s.display, stderr: '', exitCode: 0, durationMs: 5, command: s.display }
    }
  }
  const runner = createSerialRunner(inner)
  const results = await Promise.allSettled(['a', 'b', 'c'].map((d) => runner.run(spec(d))))
  expect(peak).toBe(1)
  expect(order).toEqual(['a', 'b', 'c'])
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
})

test('a command with onStdout holds the queue only until its first output', async () => {
  let finishLogin = (): void => undefined
  const order: string[] = []
  const inner: Runner = {
    async run(s) {
      order.push(`start ${s.display}`)
      if (s.display === 'login') {
        s.onStdout?.('{"status":"pending"}')
        await new Promise<void>((resolve) => (finishLogin = resolve))
      }
      order.push(`end ${s.display}`)
      return { stdout: '', stderr: '', exitCode: 0, durationMs: 0, command: s.display }
    }
  }
  const runner = createSerialRunner(inner)
  const login = runner.run({ ...spec('login'), onStdout: () => undefined })
  await runner.run(spec('devices'))
  finishLogin()
  await login
  expect(order).toEqual(['start login', 'start devices', 'end devices', 'end login'])
})

test('a stream holds the queue only until its first chunk', async () => {
  let finishStream = (): void => undefined
  const order: string[] = []
  const inner: Runner = {
    async run(s) {
      order.push(`start ${s.display}`)
      if (s.display === 'logs') {
        s.stream?.onChunk('Nov 08 07:27:00.257342 …\n')
        await new Promise<void>((resolve) => (finishStream = resolve))
      }
      order.push(`end ${s.display}`)
      return { stdout: '', stderr: '', exitCode: 0, durationMs: 0, command: s.display }
    }
  }
  const runner = createSerialRunner(inner)
  const logs = runner.run({ ...spec('logs'), stream: { onChunk: () => undefined } })
  await runner.run(spec('devices'))
  finishStream()
  await logs
  expect(order).toEqual(['start logs', 'start devices', 'end devices', 'end logs'])
})

test('a stream that prints nothing releases the queue after 5 s', async () => {
  vi.useFakeTimers()
  try {
    let finishStream = (): void => undefined
    const order: string[] = []
    const inner: Runner = {
      async run(s) {
        order.push(`start ${s.display}`)
        if (s.display === 'logs') {
          await new Promise<void>((resolve) => (finishStream = resolve))
        }
        order.push(`end ${s.display}`)
        return { stdout: '', stderr: '', exitCode: 0, durationMs: 0, command: s.display }
      }
    }
    const runner = createSerialRunner(inner)
    const logs = runner.run({ ...spec('logs'), stream: { onChunk: () => undefined } })
    const devices = runner.run(spec('devices'))
    await vi.advanceTimersByTimeAsync(4_999)
    expect(order).toEqual(['start logs'])
    await vi.advanceTimersByTimeAsync(1)
    await devices
    expect(order).toEqual(['start logs', 'start devices', 'end devices'])
    finishStream()
    await logs
  } finally {
    vi.useRealTimers()
  }
})
