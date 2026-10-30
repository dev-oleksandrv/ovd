import type { Command } from 'commander'
import { OvdError, TV_USB_MODE, type Device } from '@ovd/core'
import type { CliDeps } from '../program.js'
import { details } from '../format/devices.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

interface PairOptions {
  usb?: boolean
  port?: string
}

export function registerPairing(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  program
    .command('pair')
    .description('Pair a stick over Wi-Fi: switch it from USB, or connect to <ip>[:port]')
    .argument('[address]', 'IP address and port of a stick already in TCP/IP mode')
    .option('--usb', 'switch the stick plugged in over USB to TCP/IP, then connect')
    .option('--port <port>', 'TCP/IP port for --usb (default 5555)')
    .action(async (address: string | undefined, opts: PairOptions, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(
        ctx,
        () => {
          if (opts.usb === true && address === undefined) {
            ctx.output.stderr('Switching the stick to TCP/IP…\n')
            return deps.ovd().pairing.pairUsb({
              ...(ctx.device === undefined ? {} : { device: ctx.device }),
              ...(opts.port === undefined ? {} : { port: Number(opts.port) })
            })
          }
          if (opts.usb !== true && address !== undefined && opts.port === undefined) {
            ctx.output.stderr(`Connecting to ${address}…\n`)
            return deps.ovd().pairing.pair(address)
          }
          return Promise.reject(
            new OvdError(
              'INVALID_ADDRESS',
              'Pair with --usb or with an address, not both',
              'ovd pair --usb [--port <port>], or ovd pair <ip>[:port]'
            )
          )
        },
        { json: (device) => ({ device }), human: (device) => `Paired ${line(device)}\n` }
      )
    })

  program
    .command('connect')
    .description('Connect again to a saved Wi-Fi device')
    .argument('<id>', 'device ID, <ip>:<port> (see ovd devices)')
    .action(async (id: string, _opts, cmd: Command) => {
      await report(reportContext(cmd, deps, setExitCode), () => deps.ovd().pairing.connect(id), {
        json: (device) => ({ device }),
        human: (device) => `Connected ${line(device)}\n`
      })
    })

  program
    .command('forget')
    .description('Disconnect a Wi-Fi device and stop remembering it')
    .argument('<id>', 'device ID, <ip>:<port> (see ovd devices)')
    .action(async (id: string, _opts, cmd: Command) => {
      await report(reportContext(cmd, deps, setExitCode), () => deps.ovd().pairing.forget(id), {
        json: (result) => result,
        human: (result) =>
          result.switchedToUsb
            ? `Forgot ${result.id}; the stick is switching back to USB\n`
            : // A stick left in TCP/IP mode is invisible on USB until switched back.
              `Forgot ${result.id}\nIt stays in TCP/IP mode. To use it over USB, on the TV: ${TV_USB_MODE}\n`
      })
    })
}

function line(device: Device): string {
  return `${device.name} (${device.id} · ${details(device)})`
}
