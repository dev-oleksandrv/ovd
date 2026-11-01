import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

// Every field is optional: a project is still a project while its manifest is being written.
const manifestSchema = z.object({
  package: z
    .object({
      id: z.string().optional(),
      title: z.string().optional(),
      version: z.string().optional()
    })
    .optional(),
  os: z
    .object({
      version: z.object({ target: z.string().optional(), min: z.string().optional() }).optional()
    })
    .optional()
})

const packageJsonSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional()
})

export interface ProjectManifest {
  packageId?: string
  title?: string
  version?: string
  osTarget?: string
  rnVersion?: string
}

// The files that make a folder a Vega project.
export const PROJECT_FILES = ['manifest.toml', 'package.json'] as const

// Reads what the project pins. A Vega project records no SDK version, only the OS version
// (`[os.version] target`) and the React Native version it depends on.
export async function readProject(folder: string): Promise<ProjectManifest> {
  const [manifest, pkg] = await Promise.all([
    readFile(join(folder, 'manifest.toml'), 'utf8').then(parseManifest, () => undefined),
    readFile(join(folder, 'package.json'), 'utf8').then(parsePackageJson, () => undefined)
  ])
  const rnVersion = majorMinor(pkg?.dependencies?.['react-native'])
  return {
    ...defined('packageId', manifest?.package?.id),
    ...defined('title', manifest?.package?.title),
    ...defined('version', manifest?.package?.version),
    ...defined('osTarget', manifest?.os?.version?.target),
    ...defined('rnVersion', rnVersion)
  }
}

function parseManifest(text: string): z.infer<typeof manifestSchema> | undefined {
  try {
    return manifestSchema.safeParse(parseToml(text)).data
  } catch {
    return undefined
  }
}

function parsePackageJson(text: string): z.infer<typeof packageJsonSchema> | undefined {
  try {
    return packageJsonSchema.safeParse(JSON.parse(text)).data
  } catch {
    return undefined
  }
}

// `0.83.0`, `^0.72.4`, `~0.72` → `0.83`, `0.72`. Ranges like `*` or tags carry no version.
function majorMinor(range: string | undefined): string | undefined {
  const match = range === undefined ? null : /(\d+)\.(\d+)/.exec(range)
  return match ? `${match[1]}.${match[2]}` : undefined
}

function defined<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>)
}
