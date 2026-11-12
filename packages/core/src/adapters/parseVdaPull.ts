export type VdaPull = { ok: true } | { ok: false; message: string }

const PULLED = /: 1 file pulled, /
const ERROR = /^vda: error: (.+)$/m

// `vda pull <remote> <local>` has no JSON mode. It prints `<remote>: 1 file pulled, 0 skipped.
// …` and exits 0; a remote that doesn't exist prints `vda: error: failed to stat remote object
// '<remote>': No such file or directory` on STDOUT and exits 1 (fixtures/0.24/vda-pull). An
// empty remote pulls an empty file with exit 0, so the caller checks the file itself.
export function parseVdaPull(result: {
  stdout: string
  stderr: string
  exitCode: number
}): VdaPull {
  if (result.exitCode === 0 && PULLED.test(result.stdout)) return { ok: true }
  const text = `${result.stdout}\n${result.stderr}`
  const error = ERROR.exec(text)?.[1]
  if (error) return { ok: false, message: error.trim() }
  const lastLine = text.trim().split('\n').at(-1)?.trim() ?? ''
  return { ok: false, message: lastLine || `exit code ${result.exitCode}` }
}
