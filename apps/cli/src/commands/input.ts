import { OvdError, REMOTE_KEYS } from '@ovd/core'
import type { Command } from 'commander'
import { pressedLine, typedLine } from '../format/input.js'
import type { CliDeps } from '../program.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

// `ovd input press <key...>` and `ovd input text <text>` (Stage 4.2): sticks through
// `inputd-cli`, the Virtual Device through emulator gRPC (ADR 0010). Each call is one device
// action, logged by core (ADR 0011). Ctrl+C closes the session instead of leaving the console.
export function registerInput(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  const input = program.command('input').description('Send remote keys and text to the target')

  input
    .command('press')
    .description('Press remote keys on the target, in order')
    .argument('<key...>', REMOTE_KEYS.join(', '))
    .action(async (keys: string[], _opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(
        ctx,
        () =>
          cancellable((signal) => deps.ovd().input.press(keys, { ...device(ctx.device), signal })),
        { json: (result) => ({ input: result }), human: pressedLine }
      )
    })

  input
    .command('text')
    .description('Type text on the target (quote it; use -- before text that starts with -)')
    .argument('<text>', 'the text to type')
    .action(async (text: string, _opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(
        ctx,
        () =>
          cancellable((signal) => deps.ovd().input.text(text, { ...device(ctx.device), signal })),
        { json: (result) => ({ input: result }), human: typedLine }
      )
    })

  function device(d: string | undefined) {
    return d === undefined ? {} : { device: d }
  }

  async function cancellable<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const dispose = deps.onInterrupt(() => controller.abort())
    try {
      return await run(controller.signal)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OvdError('COMMAND_FAILED', 'Cancelled', 'Nothing more was sent to the device')
      }
      throw error
    } finally {
      dispose()
    }
  }
}
