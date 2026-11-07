export interface VlcmTerminate {
  outcome: 'stopped' | 'not-running' | 'failed'
  reason?: string
}

// `vlcm terminate-app [--force] --pkg-id <package>` has no JSON mode. Graceful: `Stopping pkg:
// <package>` and exit 0 when the app ran; the same line, `Failed to stop app` and exit 255 when
// nothing ran or the package isn't installed. `--force` prints `Force stopping pkg: <package>`
// and exits 0 whatever the state (fixtures/0.24/vlcm-terminate-app).
export function parseVlcmTerminate(result: {
  stdout: string
  stderr: string
  exitCode: number
}): VlcmTerminate {
  const text = `${result.stdout}\n${result.stderr}`
  if (result.exitCode === 0 && /^(?:Force s|S)topping pkg: /m.test(text)) {
    return { outcome: 'stopped' }
  }
  if (result.exitCode === 255 && /^Failed to stop app/m.test(text)) {
    return { outcome: 'not-running' }
  }
  const lastLine = text.trim().split('\n').at(-1) ?? ''
  return { outcome: 'failed', reason: lastLine || `exit code ${result.exitCode}` }
}
