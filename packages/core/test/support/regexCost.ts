// V8 doesn't count backtracking steps, so the cost of a search is measured against a baseline
// timed in the same process, interleaved with it: one open-ended repeat over the whole line
// (`a*c`, quadratic), the most work the guard means to allow (MAX_BACKTRACK_PRODUCT in
// safeRegex.ts). Host load slows both alike, so the ratio holds where a fixed number of
// milliseconds didn't (#137). The best of three runs each: a load spike can slow one run, a
// backtracking bomb is slow in all of them.
const BASELINE = /a*c/i

// Accepted patterns measure up to ~1.3x the baseline on a 4096-character line; `.*a.*b`, which
// the guard refuses, measures ~600x even on a 256-character line.
export const MAX_COST_VS_BASELINE = 8

function elapsed(run: () => unknown): number {
  const started = performance.now()
  run()
  return performance.now() - started
}

// How many times the baseline's work on `text` it takes to `run` a search over the same text.
export function costVsBaseline(text: string, run: () => unknown): number {
  const runBaseline = () => BASELINE.test(text)
  let baseline = Number.POSITIVE_INFINITY
  let search = Number.POSITIVE_INFINITY
  for (let round = 0; round < 3; round++) {
    baseline = Math.min(baseline, elapsed(runBaseline))
    search = Math.min(search, elapsed(run))
  }
  return search / baseline
}
