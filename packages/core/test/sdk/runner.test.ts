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

  test('aborting rejects with an AbortError', async () => {
    const controller = new AbortController()
    const run = runner.run({ ...node('setTimeout(() => {}, 10000)'), signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })
})
