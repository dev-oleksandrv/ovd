import { describe, expect, test } from 'vitest'
import { createProgram } from '../src/program.js'

async function run(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const program = createProgram({
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text)
  })
  program.exitOverride()
  await program.parseAsync(args, { from: 'user' })
  return { stdout, stderr }
}

describe('ovd hello', () => {
  test('prints the core message', async () => {
    expect((await run('hello')).stdout).toBe('OVD core is alive\n')
  })

  test('--json prints one JSON document', async () => {
    const { stdout } = await run('hello', '--json')
    expect(JSON.parse(stdout)).toEqual({ ok: true, message: 'OVD core is alive' })
  })
})
