export type DeviceAppCommand =
  | { ok: true }
  | { ok: false; kind: 'not-installed' | 'device-not-found' | 'failed'; reason: string }

const FAILED = /^Vega operation FAILED due to an irrecoverable error: (?:Incomplete: )?(.*)$/m
const SUCCESS = {
  launch: /^Sending: pkg:\/\//m,
  uninstall: /\.\.\.success\s*$/
} as const

// `vega device launch-app` and `uninstall-app` have no JSON mode. They print `Sending:
// pkg://<component>` or `Uninstalling '<package>' ...success` on stdout and exit 0, or one
// `Vega operation FAILED …` line on stderr: exit 3 for an app that isn't installed, 2 for an
// unknown device (fixtures/0.24/vega-device-launch-app, vega-device-uninstall-app).
export function parseDeviceAppCommand(
  result: { stdout: string; stderr: string; exitCode: number },
  verb: 'launch' | 'uninstall'
): DeviceAppCommand {
  if (result.exitCode === 0 && SUCCESS[verb].test(result.stdout)) return { ok: true }
  const line = FAILED.exec(result.stderr)?.[1]?.trim()
  const lastLine = result.stderr.trim().split('\n').at(-1) ?? ''
  const reason = line || lastLine || `exit code ${result.exitCode}`
  const kind = line?.startsWith('Failed: App could not be determined')
    ? 'not-installed'
    : line?.startsWith('Device not found:')
      ? 'device-not-found'
      : 'failed'
  return { ok: false, kind, reason }
}
