import type { Runner, RunResult } from './runner.js'

// Two `vega` processes started together can break each other: the SDK relinks its workspace
// and rewrites `dependencies.pkl` on start, and the loser fails with
// `No such file or directory: 'vda'` or `EOFError` (seen with Vega CLI 1.4.5, SDK 0.24).
// So each core runs one SDK command at a time. A command with `onStdout` prints and then
// waits, for minutes (`vega devmode login` until the browser sign-in): it holds the queue
// only until its first output, once its start is over, so device polls keep running.
export function createSerialRunner(inner: Runner): Runner {
  let queue: Promise<unknown> = Promise.resolve()
  return {
    run(spec) {
      const { onStdout } = spec
      if (!onStdout) {
        const result: Promise<RunResult> = queue.then(() => inner.run(spec))
        queue = result.catch(() => undefined)
        return result
      }
      let release = (): void => undefined
      const started = new Promise<void>((resolve) => (release = resolve))
      const result: Promise<RunResult> = queue.then(() =>
        inner.run({
          ...spec,
          onStdout: (stdout) => {
            release()
            onStdout(stdout)
          }
        })
      )
      queue = Promise.race([started, result.catch(() => undefined)])
      return result
    }
  }
}
