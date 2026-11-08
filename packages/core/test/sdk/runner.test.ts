import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { OvdError } from '../../src/index.js'
import { createExecaRunner } from '../../src/sdk/runner.js'

// Real child processes, but `node` itself stands in for the SDK: no SDK or device needed.
const node = (code: string) => ({ file: process.execPath, args: ['-e', code], display: 'node' })

describe('createExecaRunner', () => {
  const runner = createExecaRunner()

  test('returns stdout, stderr and a non-zero exit code without throwing', async () => {
    const result = await runner.run(
      node("process.stdout.write('out');process.stderr.write('err');process.exit(3)")
    )
    expect(result).toMatchObject({ stdout: 'out', stderr: 'err', exitCode: 3, command: 'node' })
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('runs the command in cwd when given', async () => {
    const dir = realpathSync(tmpdir())
    const result = await runner.run({ ...node('process.stdout.write(process.cwd())'), cwd: dir })
    expect(result.stdout).toBe(dir)
  })

  test('a missing executable becomes COMMAND_FAILED', async () => {
    const run = runner.run({
      file: '/nonexistent/vega',
      args: ['--version'],
      display: 'vega --version'
    })
    await expect(run).rejects.toBeInstanceOf(OvdError)
    await expect(run).rejects.toMatchObject({
      code: 'COMMAND_FAILED',
      details: { command: 'vega --version' }
    })
  })

  test('a hanging command times out as COMMAND_FAILED with timedOut', async () => {
    const run = runner.run({ ...node('setTimeout(() => {}, 10000)'), timeoutMs: 200 })
    await expect(run).rejects.toMatchObject({ code: 'COMMAND_FAILED', details: { timedOut: true } })
  })

  test('stopWhen stops a waiting command and returns its output so far', async () => {
    const started = Date.now()
    const result = await runner.run({
      ...node(`console.log('{"status":"pending"}');setTimeout(() => {}, 30000)`),
      stopWhen: (stdout) => stdout.includes('"pending"')
    })
    expect(Date.now() - started).toBeLessThan(3000)
    expect(result).toMatchObject({ stdout: '{"status":"pending"}', stopped: true })
  })

  test('a command that finishes before stopWhen matches is not marked stopped', async () => {
    const result = await runner.run({
      ...node("process.stdout.write('done')"),
      stopWhen: (stdout) => stdout.includes('pending')
    })
    expect(result).toMatchObject({ stdout: 'done', exitCode: 0 })
    expect(result).not.toHaveProperty('stopped')
  })

  test('onStdout sees the output so far while the command keeps running', async () => {
    const seen: string[] = []
    const result = await runner.run({
      ...node(`process.stdout.write('a');setTimeout(() => process.stdout.write('b'), 50)`),
      onStdout: (stdout) => seen.push(stdout)
    })
    expect(seen).toEqual(['a', 'ab'])
    expect(result).toMatchObject({ stdout: 'ab', exitCode: 0 })
  })

  test('aborting rejects with an AbortError', async () => {
    const controller = new AbortController()
    const run = runner.run({ ...node('setTimeout(() => {}, 10000)'), signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('createExecaRunner streams', () => {
  const runner = createExecaRunner()

  // A stream spec for a `node -e` child, with the chunks it prints collected.
  function streamOf(code: string, opts: { signal?: AbortSignal; graceMs?: number } = {}) {
    const chunks: string[] = []
    let first = (): void => undefined
    const firstChunk = new Promise<void>((resolve) => (first = resolve))
    const spec = {
      ...node(code),
      ...(opts.signal ? { signal: opts.signal } : {}),
      stream: {
        onChunk: (chunk: string) => {
          chunks.push(chunk)
          first()
        },
        ...(opts.graceMs === undefined ? {} : { graceMs: opts.graceMs })
      }
    }
    return { spec, chunks, firstChunk }
  }

  const gone = (pid: number) => {
    try {
      process.kill(pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  }

  test('chunks reach onChunk in order and nothing is kept in stdout', async () => {
    const { spec, chunks } = streamOf(
      "process.stdout.write('a\\n');setTimeout(() => process.stdout.write('b\\n'), 50)"
    )
    const result = await runner.run(spec)
    expect(chunks.join('')).toBe('a\nb\n')
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(result.stdout).toBe('')
  })

  test('a multi-byte character written in two halves arrives whole', async () => {
    const { spec, chunks } = streamOf(
      "const b = Buffer.from('é');process.stdout.write(b.subarray(0, 1));" +
        'setTimeout(() => process.stdout.write(b.subarray(1)), 50)'
    )
    await runner.run(spec)
    expect(chunks.join('')).toBe('é')
    expect(chunks.every((c) => !c.includes('\uFFFD'))).toBe(true)
  })

  test('abort ends the child and its grandchild, and resolves stopped', async () => {
    const controller = new AbortController()
    const { spec, chunks, firstChunk } = streamOf(
      "const { spawn } = require('node:child_process');" +
        "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });" +
        "process.stdout.write(process.pid + ' ' + g.pid + '\\n');setInterval(() => {}, 1000)",
      { signal: controller.signal }
    )
    const run = runner.run(spec)
    await firstChunk
    const [child = 0, grandchild = 0] = chunks.join('').trim().split(' ').map(Number)
    expect(child).toBeGreaterThan(0)
    expect(grandchild).toBeGreaterThan(0)
    controller.abort()
    const result = await run
    expect(result).toMatchObject({ stopped: true, stdout: '' })
    expect(gone(child)).toBe(true)
    await expect.poll(() => gone(grandchild)).toBe(true)
  })

  test('a child that ignores SIGTERM is SIGKILLed after the grace period', async () => {
    const controller = new AbortController()
    const { spec, firstChunk } = streamOf(
      "process.on('SIGTERM', () => {});process.stdout.write('ready');setInterval(() => {}, 1000)",
      { signal: controller.signal, graceMs: 200 }
    )
    const run = runner.run(spec)
    await firstChunk
    const started = Date.now()
    controller.abort()
    const result = await run
    expect(Date.now() - started).toBeGreaterThanOrEqual(150)
    expect(result).toMatchObject({ stopped: true, exitCode: 143 })
  })

  test('a stream that exits by itself resolves its exit code without stopped', async () => {
    const { spec } = streamOf("process.stdout.write('last line\\n')")
    const result = await runner.run(spec)
    expect(result).toMatchObject({ exitCode: 0, command: 'node' })
    expect(result).not.toHaveProperty('stopped')
  })

  test('an already aborted signal stops the stream at once', async () => {
    const controller = new AbortController()
    controller.abort()
    const { spec } = streamOf('setInterval(() => {}, 1000)', { signal: controller.signal })
    const started = Date.now()
    const result = await runner.run(spec)
    expect(Date.now() - started).toBeLessThan(3000)
    expect(result).toMatchObject({ stopped: true })
  })

  test('a missing executable rejects with COMMAND_FAILED', async () => {
    const run = runner.run({
      file: '/nonexistent/vega',
      args: [],
      display: 'vega exec vda shell loggingctl log -f',
      stream: { onChunk: () => undefined }
    })
    await expect(run).rejects.toMatchObject({ code: 'COMMAND_FAILED' })
  })

  test('200 KB on stderr does not block the stream, and only 4 KB of it is kept', async () => {
    const { spec, chunks } = streamOf(
      "process.stderr.write('x'.repeat(200 * 1024), () => process.stdout.write('after\\n'))"
    )
    const result = await runner.run(spec)
    expect(chunks.join('')).toBe('after\n')
    expect(result.exitCode).toBe(0)
    expect(result.stderr.length).toBeGreaterThan(0)
    expect(result.stderr.length).toBeLessThanOrEqual(4096)
  })

  test('a stream ended by a signal OVD did not send resolves with 128 + the signal', async () => {
    const { spec } = streamOf("process.kill(process.pid, 'SIGHUP')")
    const result = await runner.run(spec)
    expect(result).toMatchObject({ exitCode: 129 })
    expect(result).not.toHaveProperty('stopped')
  })
})
