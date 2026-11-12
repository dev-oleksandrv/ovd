import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { execa } from 'execa'
import { OvdError } from '../errors/ovdError.js'

export type ClipboardTool = 'osascript' | 'wl-copy' | 'xclip'

// One clipboard command: its stdin is the file at `stdinFile`, or nothing.
export interface ClipboardCommand {
  file: ClipboardTool
  args: string[]
  stdinFile?: string
}

export interface ClipboardDeps {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  // Runs the command with stdout and stderr ignored and resolves with its exit code. Injected
  // so tests never touch the real clipboard.
  exec?: (command: ClipboardCommand, timeoutMs: number) => Promise<number>
  // Whether `path` is an executable file.
  isExecutable?: (path: string) => Promise<boolean>
}

export interface Clipboard {
  // Copies the PNG at `path` to the host clipboard with a tool the platform already has.
  // Throws CLIPBOARD_UNAVAILABLE when there is none, or it fails.
  copyPng(path: string): Promise<{ tool: ClipboardTool }>
}

const TIMEOUT_MS = 5_000
const INSTALL_HINT = 'Install xclip (X11) or wl-clipboard (Wayland), then retry'

// `osascript` on macOS; on Linux `wl-copy` under Wayland, else `xclip` under X11. The path goes
// to osascript as an argument (`item 1 of argv`), never into the script's text. Both Linux tools
// fork a child that serves the selection, so their output is ignored and the call doesn't wait
// for that child. Linux is unverified on a real desktop session (ARCHITECTURE §5).
export async function clipboardCommand(
  path: string,
  deps: Pick<ClipboardDeps, 'platform' | 'env' | 'isExecutable'>
): Promise<ClipboardCommand | null> {
  if (deps.platform === 'darwin') {
    return {
      file: 'osascript',
      args: [
        '-e',
        'on run argv',
        '-e',
        'set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)',
        '-e',
        'end run',
        path
      ]
    }
  }
  const executable = deps.isExecutable ?? isExecutable
  const pathVar = deps.env.PATH ?? ''
  if (deps.env.WAYLAND_DISPLAY && (await onPath('wl-copy', pathVar, executable))) {
    return { file: 'wl-copy', args: ['--type', 'image/png'], stdinFile: path }
  }
  if (deps.env.DISPLAY && (await onPath('xclip', pathVar, executable))) {
    return { file: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-i', path] }
  }
  return null
}

export function createClipboard(deps: ClipboardDeps): Clipboard {
  const exec = deps.exec ?? ((command, timeoutMs) => execClipboard(command, timeoutMs, deps.env))
  return {
    async copyPng(path) {
      const command = await clipboardCommand(path, deps)
      if (!command) {
        throw new OvdError(
          'CLIPBOARD_UNAVAILABLE',
          'No clipboard tool for this session',
          deps.platform === 'linux' ? INSTALL_HINT : 'Copy the file from its folder instead'
        )
      }
      let exitCode: number
      try {
        exitCode = await exec(command, TIMEOUT_MS)
      } catch {
        exitCode = -1
      }
      if (exitCode !== 0) {
        throw new OvdError(
          'CLIPBOARD_UNAVAILABLE',
          `${command.file} couldn’t copy the screenshot`,
          deps.platform === 'linux'
            ? 'Check that the desktop session is running, then retry'
            : 'Copy the file from its folder instead'
        )
      }
      return { tool: command.file }
    }
  }
}

async function onPath(
  name: string,
  pathVar: string,
  executable: (path: string) => Promise<boolean>
): Promise<boolean> {
  for (const dir of pathVar.split(delimiter)) {
    if (dir !== '' && (await executable(join(dir, name)))) return true
  }
  return false
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

// The tool from the env's PATH, as a terminal would run it; a timeout or a failed start is -1.
async function execClipboard(
  command: ClipboardCommand,
  timeoutMs: number,
  env: Record<string, string | undefined>
): Promise<number> {
  const result = await execa(command.file, command.args, {
    reject: false,
    env,
    extendEnv: false,
    timeout: timeoutMs,
    stdin: command.stdinFile === undefined ? 'ignore' : { file: command.stdinFile },
    stdout: 'ignore',
    stderr: 'ignore'
  })
  return result.exitCode ?? -1
}
