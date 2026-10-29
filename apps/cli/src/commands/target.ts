import type { Command } from 'commander'
import type { CliDeps } from '../program.js'
import { targetLine } from '../format/devices.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

export function registerTarget(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  const target = program
    .command('target')
    .description('Show the device commands run on')
    .action(async (_opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(ctx, () => deps.ovd().devices.currentTarget(ctx.device), {
        json: (resolved) => ({
          target: resolved?.device ?? null,
          source: resolved?.source ?? null
        }),
        human: (resolved) => {
          if (resolved) return targetLine(resolved.device)
          deps.output.stderr('Set one with: ovd target set <id>\n')
          return 'No target.\n'
        }
      })
    })

  target
    .command('set')
    .description('Remember the device commands run on')
    .argument('<id>', 'device ID (see ovd devices)')
    .action(async (id: string, _opts, cmd: Command) => {
      await report(reportContext(cmd, deps, setExitCode), () => deps.ovd().devices.setTarget(id), {
        json: (d) => ({ target: d }),
        human: targetLine
      })
    })
}
