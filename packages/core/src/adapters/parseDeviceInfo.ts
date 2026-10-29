import { z } from 'zod'
import { OvdError } from '../errors/ovdError.js'

export interface DeviceInfo {
  os: string
  build: string
  architecture: string
  profile: string
  product: string
  simulated: boolean
  developerMode: boolean
  // The `vega device info` document as printed, for the detail's JSON block.
  raw: Record<string, unknown>
}

const schema = z.looseObject({
  os: z.string(),
  architecture: z.string(),
  profile: z.string(),
  product: z.string(),
  buildDescription: z.string(),
  simulated: z.boolean().optional(),
  inDeveloperMode: z.boolean().optional()
})

// ADR 0008 compares normalized names; sticks report `armv7l`.
const ARCHITECTURES: Record<string, string> = { armv7l: 'armv7' }

// `vega device info` prints JSON by default (fixtures/0.24/vega-device-info). For an unknown,
// booting or ambiguous device it still exits 0, with empty fields.
export function parseDeviceInfo(stdout: string): DeviceInfo {
  const parsed = schema.safeParse(parseJson(stdout))
  if (!parsed.success) {
    throw new OvdError(
      'UNEXPECTED_OUTPUT',
      'Could not read vega device info',
      'Check the Vega SDK install with ovd doctor',
      { stdout: stdout.slice(0, 200) }
    )
  }
  const doc = parsed.data
  if (doc.architecture === '') {
    throw new OvdError(
      'DEVICE_INFO_UNAVAILABLE',
      'Device info is not available',
      'The device may still be booting. Wait a few seconds and retry'
    )
  }
  const description = /^(.*?) \((.*)\)$/.exec(doc.buildDescription)
  return {
    os: description?.[1] ?? (doc.buildDescription || doc.os),
    build: description?.[2] ?? '',
    architecture: ARCHITECTURES[doc.architecture] ?? doc.architecture,
    profile: doc.profile,
    product: doc.product,
    simulated: doc.simulated ?? false,
    developerMode: doc.inDeveloperMode ?? false,
    raw: doc
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
