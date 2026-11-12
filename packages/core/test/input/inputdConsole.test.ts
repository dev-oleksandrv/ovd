import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  CLOSE_GRACE_MS,
  InputdConsoleError,
  openInputdConsole,
  WELCOME_TIMEOUT_MS
} from '../../src/input/inputdConsole.js'
import { FakeRunner } from '../support/fakeRunner.js'
import { InputdStream, type InputdStreamOptions } from '../support/fakeInputd.js'
import { fixture } from '../support/fixtures.js'

const CONSOLE = 'vega exec vda -s G070000000000001 shell inputd-cli start'

function setup(opts: InputdStreamOptions = {}) {
  const stream = new InputdStream(opts)
  const runner = new FakeRunner({ [CONSOLE]: stream })
  const open = () =>
    openInputdConsole({ runner, vegaPath: '/sdk/vega', vdaSerial: 'G070000000000001' })
  return { stream, runner, open }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('openInputdConsole', () => {
  test('starts one inputd-cli console stream with stdin and waits for its welcome', async () => {
    const { runner, open, stream } = setup()
    const session = await open()
    expect(session.command).toBe(CONSOLE)
    expect(runner.calls).toHaveLength(1)
    expect(runner.calls[0]?.stream?.input).toBeTypeOf('function')
    expect(stream.lines).toEqual([])
  })

  test('send writes one line and resolves with the reply, without the prompt', async () => {
    const { open, stream } = setup()
    const session = await open()
    expect(await session.send('button_press KEY_UP', 1_000)).toBe(
      'Injecting Button Press As Driver: KEY_UP State: short'
    )
    expect(stream.written).toEqual(['button_press KEY_UP\n'])
  })

  test('lines go one at a time: the next is written only after the reply', async () => {
    let answer: (() => void) | undefined
    const { open, stream } = setup({
      answer: (line) => {
        if (line !== 'button_press KEY_UP') return undefined
        answer = () => stream.emit(fixture('0.24/inputd-cli-console/button-press.txt'))
        return null
      }
    })
    const session = await open()
    const first = session.send('button_press KEY_UP', 1_000)
    const second = session.send('button_press KEY_DOWN', 1_000)
    await Promise.resolve()
    expect(stream.lines).toEqual(['button_press KEY_UP'])
    answer?.()
    await first
    await second
    expect(stream.lines).toEqual(['button_press KEY_UP', 'button_press KEY_DOWN'])
  })

  test('a reply in chunks ends only at its prompt, even when the text echoes the prompt', async () => {
    const { open, stream } = setup({ answer: () => null })
    const session = await open()
    const reply = session.send('send_text "inputd-cli > "', 1_000)
    stream.emit('Injecting Text: inputd-cli > ')
    stream.emit('\n\r')
    stream.emit('\ninputd-cli > ')
    expect(await reply).toBe('Injecting Text: inputd-cli > ')
  })

  test('no welcome in 10 s: timeout, and the stream is stopped', async () => {
    vi.useFakeTimers()
    const { open, stream } = setup({ welcome: false })
    const opened = open().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(WELCOME_TIMEOUT_MS)
    expect(await opened).toMatchObject({ name: 'InputdConsoleError', reason: 'timeout' })
    expect(stream.stopped).toBe(true)
  })

  test('a stream that ends before its welcome', async () => {
    const { open, stream } = setup({ welcome: false })
    const opened = open().catch((e: unknown) => e)
    stream.end(1, fixture('0.24/vda-shell/stick-usb-not-found.stderr.txt'))
    expect(await opened).toEqual(new InputdConsoleError('not-found'))
  })

  test('no reply in time: timeout, the console ends and is stopped', async () => {
    vi.useFakeTimers()
    const { open, stream } = setup({ answer: () => null })
    const session = await open()
    const reply = session.send('button_press KEY_UP', 5_000).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await reply).toMatchObject({ reason: 'timeout' })
    expect(stream.stopped).toBe(true)
    expect(session.ended()).toBe(true)
  })

  test('a stream that ends mid-command fails it; the next send fails at once', async () => {
    const { open, stream } = setup({ answer: () => null })
    const session = await open()
    const reply = session.send('button_press KEY_UP', 5_000).catch((e: unknown) => e)
    await Promise.resolve()
    stream.end(0)
    expect(await reply).toMatchObject({ reason: 'ended' })
    expect(session.ended()).toBe(true)
    await expect(session.send('button_press KEY_UP', 5_000)).rejects.toMatchObject({
      reason: 'ended'
    })
  })

  test('close writes exit and resolves once the console exits; no error', async () => {
    const { open, stream } = setup()
    const session = await open()
    await session.close()
    expect(stream.written).toEqual(['exit\n'])
    expect(stream.stopped).toBe(false)
    expect(session.ended()).toBe(true)
  })

  test('close waits for the command in flight before exit', async () => {
    const { open, stream } = setup()
    const session = await open()
    const reply = session.send('button_press KEY_UP', 1_000)
    await session.close()
    await reply
    expect(stream.lines).toEqual(['button_press KEY_UP', 'exit'])
  })

  test('a console that ignores exit is stopped after the grace period', async () => {
    vi.useFakeTimers()
    const { open, stream } = setup({ onExit: 'ignore' })
    const session = await open()
    const closed = session.close()
    await vi.advanceTimersByTimeAsync(CLOSE_GRACE_MS - 1)
    expect(stream.stopped).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await closed
    expect(stream.stopped).toBe(true)
  })

  test('stop stops the stream at once and fails what is pending', async () => {
    const { open, stream } = setup({ answer: () => null })
    const session = await open()
    const reply = session.send('button_press KEY_UP', 5_000).catch((e: unknown) => e)
    await Promise.resolve()
    await session.stop()
    expect(stream.stopped).toBe(true)
    expect(await reply).toMatchObject({ reason: 'ended' })
  })
})
