import { unexpectedOutput } from './unexpectedOutput.js'

// `vda usb` confirms the switch back from TCP/IP (fixtures/0.24/vda-usb/restarting.txt). On a
// stick it often printed nothing (exit 0) and had switched all the same
// (fixtures/0.24/vda-usb/empty.txt).
export function parseVdaUsb(stdout: string): void {
  const line = stdout.trim()
  if (line !== '' && line !== 'restarting in USB mode') throw unexpectedOutput('vda usb', stdout)
}
