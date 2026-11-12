import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Sandbox } from './sandbox.ts'

// The bundle users install from npm, not the sources: e2e tests what ships.
export const CLI_BIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../apps/cli/dist/index.js'
)

export interface CliRun {
  exitCode: number
  stdout: string
  stderr: string
  // The single `--json` document on stdout.
  json<T = Record<string, unknown>>(): T
  // Every JSON line on stdout, for commands that print progress lines before the result.
  jsonLines<T = Record<string, unknown>>(): T[]
}

export interface RunningOvd {
  pid: number
  // Resolves with stdout so far once `predicate` holds for it.
  waitForStdout(predicate: (stdout: string) => boolean, timeoutMs?: number): Promise<string>
  signal(name: NodeJS.Signals): void
  done: Promise<CliRun>
}

// Starts `ovd` without waiting for it, for commands that run until stopped (`ovd logs`).
export function startOvd(
  sandbox: Sandbox,
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {}
): RunningOvd {
  if (!existsSync(CLI_BIN)) {
    throw new Error(`${CLI_BIN} is missing: build the CLI first (pnpm run test:e2e builds it)`)
  }
  const child = spawn(process.execPath, [CLI_BIN, ...args], {
    cwd: sandbox.home,
    env: { ...sandbox.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  sandbox.track(child)
  let stdout = ''
  let stderr = ''
  const waiters = new Set<() => void>()
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
    for (const check of waiters) check()
  })
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const timeoutMs = opts.timeoutMs ?? 30_000
  const done = new Promise<number>((resolveExit, fail) => {
    const timer = setTimeout(() => {
      stop(child)
      fail(new Error(`ovd ${args.join(' ')} did not exit within ${timeoutMs} ms\n${stderr}`))
    }, timeoutMs)
    child.on('error', fail)
    child.on('close', (code) => {
      clearTimeout(timer)
      for (const check of waiters) check()
      resolveExit(code ?? -1)
    })
  }).then((exitCode) => result(exitCode, stdout, stderr))
  return {
    pid: child.pid ?? -1,
    waitForStdout(predicate, waitMs = 15_000) {
      return new Promise((resolveWait, fail) => {
        const timer = setTimeout(() => {
          waiters.delete(check)
          fail(new Error(`ovd ${args.join(' ')}: stdout never matched\n${stdout}\n${stderr}`))
        }, waitMs)
        const check = () => {
          if (!predicate(stdout)) return
          clearTimeout(timer)
          waiters.delete(check)
          resolveWait(stdout)
        }
        waiters.add(check)
        check()
      })
    },
    signal: (name) => void child.kill(name),
    done
  }
}

export async function ovd(
  sandbox: Sandbox,
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {}
): Promise<CliRun> {
  if (!existsSync(CLI_BIN)) {
    throw new Error(`${CLI_BIN} is missing: build the CLI first (pnpm run test:e2e builds it)`)
  }
  const child = spawn(process.execPath, [CLI_BIN, ...args], {
    cwd: sandbox.home,
    env: { ...sandbox.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  sandbox.track(child)
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const timeoutMs = opts.timeoutMs ?? 30_000
  const exitCode = await new Promise<number>((done, fail) => {
    const timer = setTimeout(() => {
      stop(child)
      fail(new Error(`ovd ${args.join(' ')} did not exit within ${timeoutMs} ms\n${stderr}`))
    }, timeoutMs)
    child.on('error', fail)
    child.on('close', (code) => {
      clearTimeout(timer)
      done(code ?? -1)
    })
  })
  return result(exitCode, stdout, stderr)
}

// SIGTERM first, so ovd stops its SDK process groups (a SIGKILL would leave them running), then
// SIGKILL if it is still there.
const KILL_AFTER_MS = 3_000
function stop(child: ChildProcess): void {
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS)
  timer.unref()
  child.once('close', () => clearTimeout(timer))
}

function result(exitCode: number, stdout: string, stderr: string): CliRun {
  const lines = (): unknown[] =>
    stdout
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as unknown)
  return {
    exitCode,
    stdout,
    stderr,
    json<T>() {
      const all = lines()
      if (all.length !== 1) throw new Error(`Expected one JSON document, got:\n${stdout}`)
      return all[0] as T
    },
    jsonLines: <T>() => lines() as T[]
  }
}
