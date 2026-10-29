import type { Command } from 'commander'
import type { CliDeps } from '../program.js'
import { deviceRows } from '../format/devices.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

export function registerDevice(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  const device = program.command('device').description('One device: info and name')

  device
    .command('info')
    .description('Show what the device reports')
    .argument('<id>', 'device ID (see ovd devices)')
    .action(async (id: string, _opts, cmd: Command) => {
      await report(reportContext(cmd, deps, setExitCode), () => deps.ovd().devices.get(id), {
        json: (d) => ({ device: d }),
        human: deviceRows
      })
    })

  device
    .command('rename')
    .description('Give the device a name (kept per serial, on this computer)')
    .argument('<id>', 'device ID (see ovd devices)')
    .argument('<name>', 'new name')
    .action(async (id: string, name: string, _opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(ctx, () => deps.ovd().devices.rename(id, name), {
        json: (d) => ({ device: d }),
        human: (d) => `Renamed ${d.id} to ${d.name}\n`
      })
    })
}
