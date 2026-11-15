import { z } from 'zod'
import { OvdError } from '../errors/ovdError.js'

const schema = z.object({ running: z.boolean() })

// `vega virtual-device status` prints one JSON line on stdout; logs go to stderr.
export function parseVvdStatus(stdout: string): { running: boolean } {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    json = undefined
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new OvdError(
      'UNEXPECTED_OUTPUT',
      'Could not read vega virtual-device status',
      'Check the Vega SDK install with ovd doctor',
      { stdout: stdout.slice(0, 200) }
    )
  }
  return { running: parsed.data.running }
}

const NO_INSTANCE = /cannot find virtual device instance/

// SDK 2.0 before the first `virtual-device start`: `status` exits 1 because the default
// instance doesn't exist yet (fixtures/2.0/vega-virtual-device-status/no-instance.txt). The
// Virtual Device is installed and stopped; `start` creates the instance (ARCHITECTURE §8).
export function isVvdNoInstance(result: {
  stdout: string
  stderr: string
  exitCode: number
}): boolean {
  return result.exitCode !== 0 && NO_INSTANCE.test(`${result.stdout}\n${result.stderr}`)
}
