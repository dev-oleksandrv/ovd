import { expect, test } from 'vitest'
import { usbStick } from '../fake-sdk/world.ts'
import { startOvd } from '../harness/cli.ts'
import { openSandbox, stillRunning } from '../harness/sandbox.ts'

// The harness itself: a test that ends with `ovd` still running (a failed wait or assertion, a
// test timeout) must not leave it, or the SDK processes it started, running after the run.
// openSandbox, not createSandbox: this test closes the sandbox itself, to check what close() does.
test('closing the sandbox stops an ovd the test left running, and its log stream, and says so', async () => {
  const sandbox = openSandbox({ stick: usbStick() })
  let pids: number[] = []
  let closed: Promise<void> | undefined
  try {
    sandbox.installSdk()
    const running = startOvd(sandbox, ['logs', '--json'])
    await running.waitForStdout((out) => out.includes('\n'))
    pids = [running.pid, ...sandbox.logStreamPids()]
    expect(pids.length).toBeGreaterThan(1)
    // Not stopped: the test "ends" here.
    closed = sandbox.close()
    await expect(closed).rejects.toThrow(/Still running after the test, stopped now:/)
  } finally {
    if (closed === undefined) await sandbox.close().catch(() => undefined)
  }
  expect(stillRunning(pids)).toEqual([])
})
