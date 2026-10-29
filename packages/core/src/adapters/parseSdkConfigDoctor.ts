import { z } from 'zod'
import { parseJson, unexpectedOutput } from './unexpectedOutput.js'

const schema = z.object({
  status: z.string(),
  corruptedComponents: z.number(),
  removedComponents: z.number()
})

export interface SdkConfigDoctor {
  status: string
  corrupted: number
  removed: number
}

// `vega sdk config doctor --json` (Vega CLI only).
export function parseSdkConfigDoctor(stdout: string): SdkConfigDoctor {
  const parsed = schema.safeParse(parseJson(stdout))
  if (!parsed.success) throw unexpectedOutput('vega sdk config doctor', stdout)
  return {
    status: parsed.data.status,
    corrupted: parsed.data.corruptedComponents,
    removed: parsed.data.removedComponents
  }
}
