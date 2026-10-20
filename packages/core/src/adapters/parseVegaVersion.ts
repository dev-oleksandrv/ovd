import { OvdError } from '../errors/ovdError.js'

// Two CLIs answer to `vega`: the Vega CLI / SDK Manager prints both versions,
// the CLI bundled inside an SDK prints only the SDK version (fixtures/0.24/vega-version).
export type VegaVersion =
  | { cli: 'manager'; sdkVersion: string; cliVersion: string }
  | { cli: 'bundled'; sdkVersion: string }

const VERSION = String.raw`\d+(?:\.\d+)+`
const MANAGER = new RegExp(
  String.raw`^Active SDK Version:\s*(${VERSION})\s*\nVega CLI Version:\s*(${VERSION})\s*$`
)
const BUNDLED = new RegExp(String.raw`^(${VERSION})$`)

export function parseVegaVersion(stdout: string): VegaVersion {
  const text = stdout.replace(/\r\n/g, '\n').trim()
  const manager = MANAGER.exec(text)
  if (manager?.[1] && manager[2]) {
    return { cli: 'manager', sdkVersion: manager[1], cliVersion: manager[2] }
  }
  const bundled = BUNDLED.exec(text)
  if (bundled?.[1]) return { cli: 'bundled', sdkVersion: bundled[1] }
  throw new OvdError(
    'UNEXPECTED_OUTPUT',
    'Could not read the version from vega --version',
    'Check the Vega SDK install with ovd doctor',
    { stdout: text.slice(0, 200) }
  )
}
