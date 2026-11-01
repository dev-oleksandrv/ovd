import type { CommandSpec } from './runner.js'

type RunOptions = Pick<CommandSpec, 'timeoutMs' | 'signal' | 'cwd'>

// `display` always starts with `vega`, never the absolute path: it is what users see and copy.
export function vegaCmd(vegaPath: string, args: string[], opts: RunOptions = {}): CommandSpec {
  return { file: vegaPath, args, display: ['vega', ...args].join(' '), ...opts }
}

// `vega device …` targets a device with `--device` (it rejects `-s`).
export function vegaDeviceCmd(
  vegaPath: string,
  sub: string,
  args: string[],
  device?: string,
  opts: RunOptions = {}
): CommandSpec {
  const target = device === undefined ? [] : ['--device', device]
  return vegaCmd(vegaPath, ['device', sub, ...args, ...target], opts)
}

// VDA always runs through `vega exec vda` and takes the VDA serial with `-s`.
export function vdaCmd(
  vegaPath: string,
  args: string[],
  vdaSerial?: string,
  opts: RunOptions = {}
): CommandSpec {
  const target = vdaSerial === undefined ? [] : ['-s', vdaSerial]
  return vegaCmd(vegaPath, ['exec', 'vda', ...target, ...args], opts)
}

// `vpt` runs through `vega exec vpt`: it isn't on PATH, and both CLIs ship it. The SDK wrapper
// breaks when two calls overlap, which the serial runner already prevents.
export function vptCmd(vegaPath: string, args: string[], opts: RunOptions = {}): CommandSpec {
  return vegaCmd(vegaPath, ['exec', 'vpt', ...args], opts)
}
