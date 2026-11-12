import { isOvdError, OvdError } from '@ovd/core'
import type { Command } from 'commander'
import { savedLine, type ScreenshotOutcome } from '../format/screenshot.js'
import type { CliDeps } from '../program.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

interface ScreenshotFlags {
  out?: string
  force?: boolean
  clipboard?: boolean
}

// `ovd screenshot [--out <path>] [--force] [--clipboard]` (Stage 4.3): one PNG from the target,
// saved in the captures folder (or `--out`). The capture is the device action core logs; the
// copy to the clipboard is a host action after it, and a failed copy is the command's error
// with the result still in the JSON document, since the file was saved.
export function registerScreenshot(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  program
    .command('screenshot')
    .description('Save a screenshot of the target as a PNG')
    .option('--out <path>', 'a .png file or a folder (default: ~/ovd/captures)')
    .option('--force', 'replace the --out file if it exists')
    .option('--clipboard', 'also copy the screenshot to the clipboard')
    .action(async (flags: ScreenshotFlags, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      let copyError: OvdError | undefined
      await report(
        ctx,
        async (): Promise<ScreenshotOutcome> => {
          const ovd = deps.ovd()
          const result = await cancellable((signal) =>
            ovd.screenshot.take({
              ...(ctx.device === undefined ? {} : { device: ctx.device }),
              ...(flags.out === undefined ? {} : { out: flags.out }),
              force: flags.force ?? false,
              signal
            })
          )
          if (!flags.clipboard) return { ...result, copied: false }
          try {
            await ovd.screenshot.copy(result.path)
            return { ...result, copied: true }
          } catch (error) {
            if (!isOvdError(error)) throw error
            copyError = new OvdError(
              error.code,
              `Saved ${result.path}, but couldn’t copy it to the clipboard: ${error.message}`,
              error.hint
            )
            return { ...result, copied: false }
          }
        },
        {
          json: (result) => ({ screenshot: result }),
          human: savedLine,
          failure: () => copyError
        }
      )
    })

  async function cancellable<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    const dispose = deps.onInterrupt(() => controller.abort())
    try {
      return await run(controller.signal)
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OvdError('COMMAND_FAILED', 'Cancelled', 'Nothing was saved')
      }
      throw error
    } finally {
      dispose()
    }
  }
}
