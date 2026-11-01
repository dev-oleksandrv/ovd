import { z } from 'zod'
import { parseJson, unexpectedOutput } from './unexpectedOutput.js'

export type BuildType = 'debug' | 'release'

const schema = z.object({ developmentEnabled: z.boolean() })

// `assets/raw/keplerscript-app-config.json` from `vpt dump`: Debug builds set
// `developmentEnabled`, Release builds clear it. Nothing else in the package names the build type.
export function parseAppConfig(stdout: string): { buildType: BuildType } {
  const parsed = schema.safeParse(parseJson(stdout))
  if (!parsed.success) throw unexpectedOutput('the app config', stdout)
  return { buildType: parsed.data.developmentEnabled ? 'debug' : 'release' }
}
