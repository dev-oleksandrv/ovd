import type { Command } from 'commander'
import type { CliDeps } from '../program.js'
import { devicesTable } from '../format/devices.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

export function registerDevices(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  program
    .command('devices')
    .description('List devices: USB and Wi‑Fi sticks and the Virtual Device')
    .action(async (_opts, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(ctx, () => deps.ovd().devices.list(), {
        json: (snapshot) => snapshot,
        human: (snapshot) => {
          // ADR 0009: a stick without Developer Mode is invisible to VDA, so say why.
          if (!snapshot.devices.some((d) => d.kind === 'stick')) {
            deps.output.stderr('A Fire TV stick shows up here only after Developer Mode is on.\n')
          }
          return devicesTable(snapshot.devices)
        }
      })
    })
}
