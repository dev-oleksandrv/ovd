export type InstallApp =
  | { installed: true }
  | { installed: false; kind: 'device-not-found' | 'missing-dependency' | 'failed'; reason: string }

const FAILED = /^Vega operation FAILED due to an irrecoverable error: (?:Incomplete: )?(.*)$/m
// The device's own answer inside the SDK's message: `Installing/Updating '<file>' ...error
// (Module dependency not found): error: Unable to install …`.
const DEVICE_ERROR = /\.\.\.error \([^)]*\): (?:error: )?(.*)$/

// `vega device install-app` has no JSON mode. It prints `…success` on stdout and exits 0, or
// one `Vega operation FAILED …` line on stderr and exits 1, or 2 for an unknown device
// (fixtures/0.24/vega-device-install-app). It installs a package built for another
// architecture without complaint, so it can't stand in for the guard (ADR 0008).
export function parseInstallApp(result: {
  stdout: string
  stderr: string
  exitCode: number
}): InstallApp {
  if (result.exitCode === 0 && /\.\.\.success\s*$/.test(result.stdout)) return { installed: true }
  const line = FAILED.exec(result.stderr)?.[1]?.trim()
  const lastLine = result.stderr.trim().split('\n').at(-1) ?? ''
  const reason = line ? (DEVICE_ERROR.exec(line)?.[1] ?? line) : lastLine
  const kind = line?.startsWith('Device not found:')
    ? 'device-not-found'
    : /\(Module dependency not found\)/.test(line ?? '')
      ? 'missing-dependency'
      : 'failed'
  return { installed: false, kind, reason: reason || `exit code ${result.exitCode}` }
}
