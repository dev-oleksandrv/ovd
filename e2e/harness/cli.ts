import { spawn } from 'node:child_process'
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
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
  const timeoutMs = opts.timeoutMs ?? 30_000
  const exitCode = await new Promise<number>((done, fail) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`ovd ${args.join(' ')} did not exit within ${timeoutMs} ms\n${stderr}`))
    }, timeoutMs)
    child.on('error', fail)
    child.on('close', (code) => {
      clearTimeout(timer)
      done(code ?? -1)
    })
  })
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
