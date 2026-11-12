import { expect, test } from 'vitest'
import { usbStick } from '../fake-sdk/world.ts'
import { startOvd } from '../harness/cli.ts'
import { openSandbox, stillRunning } from '../harness/sandbox.ts'

// The harness itself: a test that ends with `ovd` still running (a failed wait or assertion, a
// test timeout) must not leave it, or the SDK processes it started, running after the run.
// openSandbox, not createSandbox: these tests close the sandbox themselves, to check what close()
// does.

// The lines of close()'s "Still running" list ("pid command").
function stoppedByClose(error: Error): string[] {
  const [, list = ''] = error.message.split('Still running after the test, stopped now:\n')
  return list.split('\n').filter((l) => l.startsWith('  '))
}

test('closing the sandbox stops an ovd the test left running, which stops its log stream, and says so', async () => {
  const sandbox = openSandbox({ stick: usbStick() })
  let pids: number[] = []
  let streams: number[] = []
  let closed: Promise<void> | undefined
  try {
    sandbox.installSdk()
    const running = startOvd(sandbox, ['logs', '--json'])
    await running.waitForStdout((out) => out.includes('\n'))
    streams = sandbox.logStreamPids()
    expect(streams.length).toBeGreaterThan(0)
    pids = [running.pid, ...streams]
    // Not stopped: the test "ends" here.
    closed = sandbox.close()
    const error = await closed.then(
      () => new Error('close() resolved'),
      (e: unknown) => (e instanceof Error ? e : new Error(String(e)))
    )
    expect(error.message).toMatch(/Still running after the test, stopped now:/)
    const stopped = stoppedByClose(error)
    // close() SIGTERMed ovd...
    expect(stopped).toContainEqual(
      expect.stringMatching(new RegExp(`^  ${running.pid} .*apps/cli/dist/index\\.js logs --json$`))
    )
    // ...and ovd stopped its log stream itself: close() had none left to kill (the stream ends on
    // its group's SIGTERM at once, well inside the fakes' 3 s window).
    for (const pid of streams) {
      expect(stopped.filter((l) => l.startsWith(`  ${pid} `))).toEqual([])
    }
  } finally {
    if (closed === undefined) await sandbox.close().catch(() => undefined)
  }
  expect(stillRunning(pids)).toEqual([])
})

test('a harness timeout stops ovd, which stops its log stream, before the sandbox closes', async () => {
  const sandbox = openSandbox({ stick: usbStick() })
  let pids: number[] = []
  let closed: Promise<void> | undefined
  try {
    sandbox.installSdk()
    const running = startOvd(sandbox, ['logs', '--json'], { timeoutMs: 3_000 })
    await running.waitForStdout((out) => out.includes('\n'))
    pids = [running.pid, ...sandbox.logStreamPids()]
    expect(pids.length).toBeGreaterThan(1)
    await expect(running.done).rejects.toThrow(/did not exit within/)
    // Before close(): the harness's SIGTERM alone stopped ovd and, through ovd, its stream.
    await expect.poll(() => stillRunning(pids), { timeout: 5_000 }).toEqual([])
    closed = sandbox.close()
    await expect(closed).resolves.toBeUndefined()
  } finally {
    if (closed === undefined) await sandbox.close().catch(() => undefined)
  }
  expect(stillRunning(pids)).toEqual([])
})
