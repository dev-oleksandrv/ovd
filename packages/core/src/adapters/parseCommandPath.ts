// `command -v <tool>` through the login shell: the shell may print its own lines first, so the
// last absolute path is the tool's. None means the shell didn't find it on PATH, or found an
// alias or function instead.
export function parseCommandPath(stdout: string): string | undefined {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('/'))
    .at(-1)
}
