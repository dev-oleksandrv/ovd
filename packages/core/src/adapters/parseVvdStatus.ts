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
