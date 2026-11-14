import type { Command } from 'commander'
import { BUNDLE_WARNING, MAX_BUNDLE_SECONDS, OvdError, escapeControls } from '@ovd/core'
import { bytesText } from '../format/logsBundle.js'
import type { CliDeps } from '../program.js'
import { report } from '../report.js'
import { reportContext } from './context.js'
import {
  addFilterOptions,
  addPresetOption,
  flagsOf,
  resolveFilter,
  type FilterFlags
} from './logsFilter.js'

// `ovd logs bundle` (F39): captures the journal's backlog plus a few seconds of the live stream
// and writes one `.zip` to attach to a bug report. Human output is one line (path, size, lines)
// and the warning that the lines are not redacted.
//   {"ok":true,"device":{"id","name"},"path","bytes","lines","files":[…]}

interface BundleFlags extends FilterFlags {
  duration?: string
  out?: string
  force?: boolean
}

// A path as one safe word on one line: `escapeControls` keeps tab and newline (log text needs
// them), but a file name holding either could forge a second line of output.
function printable(path: string): string {
  return escapeControls(path).replaceAll('\n', '\\n').replaceAll('\t', '\\t')
}

function durationOf(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_BUNDLE_SECONDS) {
    throw new OvdError(
      'INVALID_TIMEOUT',
      `Invalid --duration: ${escapeControls(value).slice(0, 40)}`,
      `Pass whole seconds from 1 to ${MAX_BUNDLE_SECONDS}, for example --duration 10`
    )
  }
  return Number(value)
}

export function registerLogsBundle(
  logs: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  addPresetOption(addFilterOptions(logs.command('bundle')))
    .description('Write the recent log, the apps and the crash list of the target to a .zip')
    .option('--duration <seconds>', 'seconds of the live stream to add to the backlog (default 5)')
    .option('--out <path>', 'the .zip file, or an existing folder (default: the bundles folder)')
    .option('--force', 'replace the --out file when it exists')
    .action(async (_opts: object, cmd: Command) => {
      const flags = flagsOf<BundleFlags>(cmd)
      const ctx = reportContext(cmd, deps, setExitCode)
      const controller = new AbortController()
      const dispose = deps.onInterrupt(() => controller.abort())
      try {
        await report(
          ctx,
          async () => {
            const durationS = durationOf(flags.duration)
            // Core only records the preset's name: the filter it stands for is resolved here.
            const filter = await resolveFilter(deps.ovd(), flags)
            return deps.ovd().logBundle.bundle({
              ...(ctx.device === undefined ? {} : { device: ctx.device }),
              ...(Object.keys(filter).length === 0 ? {} : { filter }),
              ...(flags.preset === undefined ? {} : { preset: flags.preset }),
              ...(durationS === undefined ? {} : { durationS }),
              ...(flags.out === undefined ? {} : { out: flags.out }),
              ...(flags.force ? { force: true } : {}),
              signal: controller.signal
            })
          },
          {
            json: (result) => ({ ...result }),
            human: (result) =>
              `Wrote ${printable(result.path)} (${bytesText(result.bytes)}, ${result.lines} lines). ${BUNDLE_WARNING}\n`
          }
        )
      } finally {
        dispose()
      }
    })
}
