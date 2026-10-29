import type { Runner, RunResult } from './runner.js'

// Two `vega` processes started together can break each other: the SDK relinks its workspace
// and rewrites `dependencies.pkl` on start, and the loser fails with
// `No such file or directory: 'vda'` or `EOFError` (seen with Vega CLI 1.4.5, SDK 0.24).
// So each core runs one SDK command at a time.
export function createSerialRunner(inner: Runner): Runner {
  let queue: Promise<unknown> = Promise.resolve()
  return {
    run(spec) {
      const result: Promise<RunResult> = queue.then(() => inner.run(spec))
      queue = result.catch(() => undefined)
      return result
    }
  }
}
