import { stat } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { OvdError } from '../errors/ovdError.js'
import type { OpenProject, StateStore } from '../state/stateStore.js'
import { expandHome, tildePath } from './paths.js'
import { PROJECT_FILES, readProject, type ProjectManifest } from './readProject.js'

export interface FolderProject extends ProjectManifest {
  kind: 'folder'
  path: string
  // `~/…` when under the home folder: what surfaces show and put in `ovd open …` echoes.
  displayPath: string
  name: string
  // The folder is gone, or no longer a Vega project, since it was opened.
  missing?: true
}

export interface VpkgSource {
  kind: 'vpkg'
  path: string
  displayPath: string
  file: string
  missing?: true
}

export type ProjectMode = FolderProject | VpkgSource

export interface ProjectDeps {
  state: StateStore
  homedir: string
  // Relative paths resolve against it (the CLI's working directory).
  cwd: string
}

// Project mode or no-project mode (Stage 2.1): what Run, Packages and install commands use.
// Saved in the host state, so the CLI and the desktop share it (ADR 0022).
export interface Project {
  // Opens a project folder, or a .vpkg to install without a project.
  open(path: string): Promise<ProjectMode>
  current(): Promise<ProjectMode | null>
  close(): Promise<void>
}

export function createProject(deps: ProjectDeps): Project {
  const tilde = (path: string) => tildePath(path, deps.homedir)

  async function describe(open: OpenProject): Promise<ProjectMode> {
    const displayPath = tilde(open.path)
    if (open.kind === 'vpkg') {
      const vpkg: VpkgSource = {
        kind: 'vpkg',
        path: open.path,
        displayPath,
        file: basename(open.path)
      }
      return (await isVpkg(open.path)) ? vpkg : { ...vpkg, missing: true }
    }
    const base = {
      kind: 'folder' as const,
      path: open.path,
      displayPath,
      name: basename(open.path)
    }
    if ((await missingProjectFile(open.path)) !== undefined) return { ...base, missing: true }
    return { ...base, ...(await readProject(open.path)) }
  }

  return {
    async open(input) {
      const path = resolve(deps.cwd, expandHome(input, deps.homedir))
      const info = await stat(path).catch(() => undefined)
      if (!info) {
        throw new OvdError(
          'PATH_NOT_FOUND',
          `${tilde(path)} doesn’t exist`,
          'Check the path and try again'
        )
      }
      let open: OpenProject
      if (info.isDirectory()) {
        const missing = await missingProjectFile(path)
        if (missing !== undefined) {
          throw new OvdError(
            'NOT_A_PROJECT',
            `Not a Vega project: no ${missing} in ${tilde(path)}`,
            'Open the folder that holds manifest.toml and package.json'
          )
        }
        open = { kind: 'folder', path }
      } else {
        if (!(await isVpkg(path))) {
          throw new OvdError(
            'NOT_A_VPKG',
            `Not a .vpkg file: ${basename(path)}`,
            'Open a .vpkg built by react-native build-vega, or a project folder'
          )
        }
        open = { kind: 'vpkg', path }
      }
      await deps.state.update((state) => ({ ...state, project: open }))
      return describe(open)
    },

    async current() {
      const { state } = await deps.state.read()
      return state.project ? describe(state.project) : null
    },

    async close() {
      await deps.state.update(({ project: _closed, ...state }) => state)
    }
  }
}

async function missingProjectFile(folder: string): Promise<string | undefined> {
  for (const file of PROJECT_FILES) {
    const info = await stat(join(folder, file)).catch(() => undefined)
    if (!info?.isFile()) return file
  }
  return undefined
}

// Only the name and a non-empty file are checked here; `vpt info` reads the package (2.2).
async function isVpkg(path: string): Promise<boolean> {
  if (!/\.vpkg$/i.test(path)) return false
  const info = await stat(path).catch(() => undefined)
  return info !== undefined && info.isFile() && info.size > 0
}
