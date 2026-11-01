import { z } from 'zod'
import { parseJson, unexpectedOutput } from './unexpectedOutput.js'

const schema = z.object({
  title: z.string(),
  id: z.string(),
  version: z.string(),
  build_number: z.number().int(),
  size: z.number().int(),
  os_version_registry: z
    .object({
      contract_package_version: z.string(),
      os_versions: z.array(z.string())
    })
    .optional()
})

export interface VptInfo {
  id: string
  title: string
  version: string
  buildNumber: number
  size: number
  osVersions: string[]
  contractPackageVersion?: string
  // The document as `vpt info --json` printed it, for the desktop's raw block.
  raw: Record<string, unknown>
}

// `vpt info --json` names no architecture and no build type (vpt 1.2.29); see
// parseVptContents and parseAppConfig for those.
export function parseVptInfo(stdout: string): VptInfo {
  const json = parseJson(stdout)
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw unexpectedOutput('vpt info', stdout)
  const { title, id, version, build_number, size, os_version_registry } = parsed.data
  return {
    id,
    title,
    version,
    buildNumber: build_number,
    size,
    osVersions: os_version_registry?.os_versions ?? [],
    ...(os_version_registry
      ? { contractPackageVersion: os_version_registry.contract_package_version }
      : {}),
    raw: json as Record<string, unknown>
  }
}
