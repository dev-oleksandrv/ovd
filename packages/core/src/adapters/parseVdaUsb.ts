import { unexpectedOutput } from './unexpectedOutput.js'

// `vda usb` confirms the switch back from TCP/IP (fixtures/0.24/vda-usb/restarting.txt).
export function parseVdaUsb(stdout: string): void {
  if (stdout.trim() !== 'restarting in USB mode') throw unexpectedOutput('vda usb', stdout)
}
