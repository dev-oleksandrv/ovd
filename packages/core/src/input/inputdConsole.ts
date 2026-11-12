import {
  inputdReplyBody,
  inputdReplyDone,
  inputdWelcomeDone
} from '../adapters/parseInputdReply.js'
import { vdaCmd } from '../sdk/commands.js'
import type { Runner, RunResult, StreamWriter } from '../sdk/runner.js'

// Why the console couldn't answer. `not-found`: VDA doesn't list the device.
export type ConsoleFailure = 'timeout' | 'ended' | 'not-found'

export class InputdConsoleError extends Error {
  override readonly name = 'InputdConsoleError'
  constructor(readonly reason: ConsoleFailure) {
    super(`inputd-cli console: ${reason}`)
  }
}

export interface InputdConsole {
  // The command shown to users (`vega exec vda -s <serial> shell inputd-cli start`).
  readonly command: string
  // Sends one console line and resolves with its reply (without the prompt). Lines go one at a
  // time; a timeout or an ended stream rejects with `InputdConsoleError` and ends the console.
  send(line: string, timeoutMs: number): Promise<string>
  // True once the stream ended (by itself, a failure or `close`).
  ended(): boolean
  // `exit`, then the process group is stopped if it is still there after CLOSE_GRACE_MS.
  close(): Promise<void>
  // Stops the process group now (Ctrl+C), failing what is pending.
  stop(): Promise<void>
}

// The console was ready about 1.1 s after start on the Virtual Device (ARCHITECTURE §8).
export const WELCOME_TIMEOUT_MS = 10_000
// How long `exit` gets before the group is stopped.
export const CLOSE_GRACE_MS = 2_000

// One persistent `inputd-cli start` (ADR 0010: one console session for low latency). It runs as
// a stream with stdin through the runner, in its own process group, so it never outlives OVD.
export async function openInputdConsole(opts: {
  runner: Runner
  vegaPath: string
  vdaSerial: string
}): Promise<InputdConsole> {
  const controller = new AbortController()
  const spec = vdaCmd(opts.vegaPath, ['shell', 'inputd-cli', 'start'], opts.vdaSerial)
  let writer: StreamWriter | undefined
  let buffer = ''
  let over = false
  let closing = false
  let lastStderr = ''
  // What waits for the buffer: the welcome, then one reply at a time.
  let waiting:
    | { done: (b: string) => boolean; resolve: (b: string) => void; fail: (e: Error) => void }
    | undefined

  const check = () => {
    if (waiting && waiting.done(buffer)) {
      const { resolve } = waiting
      const got = buffer
      waiting = undefined
      buffer = ''
      resolve(got)
    }
  }

  const run: Promise<RunResult | null> = opts.runner
    .run({
      ...spec,
      signal: controller.signal,
      stream: {
        onChunk: (chunk) => {
          buffer += chunk
          check()
        },
        input: (w) => (writer = w)
      }
    })
    .then(
      (result) => result,
      () => null
    )
  const ended = run.then((result) => {
    over = true
    lastStderr = result?.stderr ?? ''
    const pending = waiting
    waiting = undefined
    // During `close` an exit with nothing pending is how it should end.
    pending?.fail(new InputdConsoleError(/not found/.test(lastStderr) ? 'not-found' : 'ended'))
  })

  const wait = (done: (b: string) => boolean, timeoutMs: number): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      if (over) {
        reject(new InputdConsoleError(/not found/.test(lastStderr) ? 'not-found' : 'ended'))
        return
      }
      const timer = setTimeout(() => {
        waiting = undefined
        reject(new InputdConsoleError('timeout'))
        // What the console does next is unknown: it is stopped, and the next use opens another.
        controller.abort()
      }, timeoutMs)
      waiting = {
        done,
        resolve: (b) => {
          clearTimeout(timer)
          resolve(b)
        },
        fail: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      }
      check()
    })

  await wait(inputdWelcomeDone, WELCOME_TIMEOUT_MS)
  buffer = ''

  let queue: Promise<unknown> = Promise.resolve()

  return {
    command: spec.display,
    send(line, timeoutMs) {
      // Lines sent before `close` still go out; later ones fail.
      if (closing) return Promise.reject(new InputdConsoleError('ended'))
      const result = queue.then(async () => {
        if (over) throw new InputdConsoleError('ended')
        const reply = wait(inputdReplyDone, timeoutMs)
        writer?.write(`${line}\n`)
        return inputdReplyBody(await reply)
      })
      queue = result.catch(() => undefined)
      return result
    },
    ended: () => over || closing,
    async close() {
      if (closing) return ended
      closing = true
      await queue
      if (!over) {
        writer?.write('exit\n')
        const timer = setTimeout(() => controller.abort(), CLOSE_GRACE_MS)
        await ended
        clearTimeout(timer)
      }
    },
    async stop() {
      closing = true
      controller.abort()
      await ended
    }
  }
}
