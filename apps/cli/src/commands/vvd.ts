import type { Command } from 'commander'
import { OvdError } from '@ovd/core'
import type { CliDeps } from '../program.js'
import { vvdStartedLine, vvdStatusLine } from '../format/vvd.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

export function registerVvd(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  const vvd = program.command('vvd').description('Start, stop and check the Vega Virtual Device')

  vvd
    .command('status')
    .description('Show whether the Virtual Device is running')
    .action(async (_opts, cmd: Command) => {
      await report(reportContext(cmd, deps, setExitCode), () => deps.ovd().vvd.status(), {
        json: (state) => ({ vvd: state }),
        human: vvdStatusLine
      })
    })

  vvd
    .command('start')
    .description('Start the Virtual Device and wait until it is ready')
    .action(async (_opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(ctx, () => cancellable((signal) => deps.ovd().vvd.start({ signal })), {
        json: (state) => ({ vvd: state }),
        human: vvdStartedLine
      })
    })

  vvd
    .command('stop')
    .description('Stop the Virtual Device')
    .action(async (_opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      deps.output.stderr('Stopping the Virtual Device…\n')
      await report(ctx, () => deps.ovd().vvd.stop(), {
        json: (state) => ({ vvd: state }),
        human: () => 'Virtual Device stopped\n'
      })
    })

  vvd
    .command('devmode')
    .description('Developer Mode on the Virtual Device')
    .command('enable')
    .description('Turn on Developer Mode on the Virtual Device')
    .action(async (_opts, cmd: Command) => {
      await report(
        reportContext(cmd, deps, setExitCode),
        () => deps.ovd().vvd.enableDeveloperMode(),
        { json: (result) => ({ vvd: result }), human: () => 'Developer Mode on\n' }
      )
    })

  // Ctrl+C stops `vega virtual-device start` (core waits for it to exit) instead of leaving
  // it running behind a dead CLI.
  async function cancellable<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const dispose = deps.onInterrupt(() => controller.abort())
    deps.output.stderr('Starting the Virtual Device…\n')
    try {
      return await run(controller.signal)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OvdError(
          'COMMAND_FAILED',
          'Cancelled',
          'The Virtual Device may still be booting: check with ovd vvd status'
        )
      }
      throw error
    } finally {
      dispose()
    }
  }
}
