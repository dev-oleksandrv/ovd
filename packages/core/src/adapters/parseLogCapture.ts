// The started capture: its file on the device and the `timeout` pid that runs `loggingctl`
// (fixtures/0.24/log-capture/started.txt).
export interface LogCapture {
  file: string
  pid: number
}

// Both go into the stop script, so only a `mktemp` path and a positive pid pass: anything else
// from the device never reaches a shell.
const STARTED = /^(\/tmp\/tmp\.[A-Za-z0-9]+) ([1-9]\d*)$/

export function parseLogCapture(stdout: string): LogCapture | undefined {
  const m = STARTED.exec(stdout.trim())
  if (m?.[1] === undefined || m[2] === undefined) return undefined
  return { file: m[1], pid: Number(m[2]) }
}
