import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { parseAppConfig, type BuildType } from '../adapters/parseAppConfig.js'
import { parseVptChecksum } from '../adapters/parseVptChecksum.js'
import { parseVptContents, type PackageArch } from '../adapters/parseVptContents.js'
import { parseVptInfo } from '../adapters/parseVptInfo.js'
import { OvdError } from '../errors/ovdError.js'
import { expandHome, tildePath } from '../project/paths.js'
import type { Project } from '../project/project.js'
import { vptCmd } from '../sdk/commands.js'
import type { RunResult, Runner } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'

export interface PackageInfo {
  path: string
  displayPath: string
  file: string
  id: string
  title: string
  version: string
  buildNumber: number
  // The file's size in bytes.
  size: number
  // `vpt info`'s size: the unpacked contents without `meta-info/`.
  unpackedSize: number
  architecture: PackageArch
  // `unknown` for a package without the React Native app config (no JS bundle).
  buildType: BuildType | 'unknown'
  osVersions: string[]
  contractPackageVersion?: string
  sha384: string
  modifiedAt: string
  // `vpt info --json` as printed, for the desktop's raw block.
  vptInfo: Record<string, unknown>
}

export interface PackageBuild {
  path: string
  displayPath: string
  file: string
  // The folder it sits in, relative to the project (`build/armv7-release/`), or its display
  // folder for a loaded .vpkg.
  folder: string
  size: number
  modifiedAt: string
  // From the build folder's name (`build/<arch>-<debug|release>/`), without reading the
  // package: `pkg info` reads the package itself.
  folderArch?: 'armv7' | 'aarch64' | 'x86_64'
  folderBuildType?: BuildType
}

export interface PackagesDeps {
  runner: Runner
  sdk: SdkLocator
  project: Project
  homedir: string
  // Relative paths resolve against it (the CLI's working directory).
  cwd: string
}

// Packages → Overview (Stage 2.2): read a .vpkg with `vpt`, list the open project's builds.
// Inspecting a file on the host isn't a device action, so nothing goes to the activity log.
export interface Packages {
  // Without a path, reads the .vpkg open in no-project mode.
  info(path?: string): Promise<PackageInfo>
  builds(): Promise<PackageBuild[]>
  // Only the architecture, from `vpt show-contents`: the guard reads it for each candidate fix.
  architecture(path: string): Promise<PackageArch>
}

const APP_CONFIG = 'assets/raw/keplerscript-app-config.json'
// `react-native build-vega` writes intermediate packages under `build/private/`.
const SKIPPED = new Set(['private', 'node_modules'])
const MAX_DEPTH = 3
const BUILD_FOLDER = /^(armv7|aarch64|x86_64)-(debug|release)$/i

export function createPackages(deps: PackagesDeps): Packages {
  const tilde = (path: string) => tildePath(path, deps.homedir)

  async function target(input?: string): Promise<string> {
    if (input !== undefined) return resolve(deps.cwd, expandHome(input, deps.homedir))
    const mode = await deps.project.current()
    if (mode?.kind === 'vpkg') return mode.path
    throw new OvdError(
      'NO_PACKAGE',
      'No .vpkg given',
      'Pass one with ovd pkg info <file.vpkg>, or list the project’s builds with ovd pkg list'
    )
  }

  async function vpt(args: string[]): Promise<RunResult> {
    const { vegaPath } = await deps.sdk.get()
    return deps.runner.run(vptCmd(vegaPath, args))
  }

  return {
    async info(input) {
      const path = await target(input)
      const file = basename(path)
      const info = await stat(path).catch(() => undefined)
      if (!info) {
        throw new OvdError(
          'PATH_NOT_FOUND',
          `${tilde(path)} doesn’t exist`,
          'Check the path and try again'
        )
      }
      if (!info.isFile() || !/\.vpkg$/i.test(path)) throw notAVpkg(file)

      const read = await vpt(['info', '--json', path])
      if (read.exitCode !== 0) {
        if (/not a vpkg/i.test(read.stderr)) throw notAVpkg(file)
        throw failed(read)
      }
      const contents = await vpt(['show-contents', path])
      if (contents.exitCode !== 0) throw failed(contents)
      const config = await vpt(['dump', path, APP_CONFIG])
      if (config.exitCode !== 0 && !/file was not found/i.test(config.stderr)) throw failed(config)
      const checksum = await vpt(['checksum', path])
      if (checksum.exitCode !== 0) throw failed(checksum)

      const { raw, ...parsed } = parseVptInfo(read.stdout)
      return {
        path,
        displayPath: tilde(path),
        file,
        ...parsed,
        size: info.size,
        architecture: parseVptContents(contents.stdout).architecture,
        buildType: config.exitCode === 0 ? parseAppConfig(config.stdout).buildType : 'unknown',
        sha384: parseVptChecksum(checksum.stdout).sha384,
        modifiedAt: info.mtime.toISOString(),
        vptInfo: raw
      }
    },

    async architecture(path) {
      const contents = await vpt(['show-contents', path])
      if (contents.exitCode !== 0) throw failed(contents)
      return parseVptContents(contents.stdout).architecture
    },

    async builds() {
      const mode = await deps.project.current()
      if (mode === null || mode.missing) return []
      if (mode.kind === 'vpkg') {
        const build = await describeBuild(mode.path, `${tilde(dirname(mode.path))}/`)
        return build ? [build] : []
      }
      const paths = await findVpkgs(join(mode.path, 'build'), 1)
      const builds = await Promise.all(
        paths.map((path) => describeBuild(path, `${relative(mode.path, dirname(path))}/`))
      )
      return builds
        .filter((b): b is PackageBuild => b !== undefined)
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    }
  }

  async function describeBuild(path: string, folder: string): Promise<PackageBuild | undefined> {
    const info = await stat(path).catch(() => undefined)
    if (!info?.isFile()) return undefined
    const hint = BUILD_FOLDER.exec(basename(dirname(path)))
    return {
      path,
      displayPath: tilde(path),
      file: basename(path),
      folder,
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
      ...(hint?.[1] && hint[2]
        ? {
            folderArch: hint[1].toLowerCase() as NonNullable<PackageBuild['folderArch']>,
            folderBuildType: hint[2].toLowerCase() as BuildType
          }
        : {})
    }
  }
}

async function findVpkgs(folder: string, depth: number): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => [])
  const found: string[] = []
  for (const entry of entries) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH && !SKIPPED.has(entry.name)) {
        found.push(...(await findVpkgs(path, depth + 1)))
      }
    } else if (entry.isFile() && /\.vpkg$/i.test(entry.name)) {
      found.push(path)
    }
  }
  return found
}

function notAVpkg(file: string): OvdError {
  return new OvdError(
    'NOT_A_VPKG',
    `Not a .vpkg file: ${file}`,
    'Open a .vpkg built by react-native build-vega'
  )
}

function failed(result: RunResult): OvdError {
  const line = result.stderr.trim().split('\n').at(-1) ?? ''
  return new OvdError(
    'COMMAND_FAILED',
    line ? `${result.command} failed: ${line}` : `${result.command} failed`,
    'Check the Vega SDK install with ovd doctor',
    { exitCode: result.exitCode }
  )
}
