// What OVD reads from a crash report (ACR): its header and its JS stack
// (fixtures/0.24/loggingctl-vault-acr).
export interface AcrSummary {
  // `CrashLang` (`JavaScript`).
  language?: string
  // `CrashReason` (`SIGABRT`).
  signal?: string
  // The first `…Error: …` line of the JS stack.
  message?: string
  // The `at …` frames, trimmed.
  stack: string[]
}

const START = '<non_native_stack_trace>'
const END = '</non_native_stack_trace>'

// The bounded `sed` output: `Key: Value` lines up to the first blank line, then the
// `<non_native_stack_trace>` section. Enrichment only: anything else (a refused read, an
// unknown index) gives `undefined`, never an error.
export function parseAcr(stdout: string): AcrSummary | undefined {
  const lines = stdout.replace(/\r\n/g, '\n').split('\n')
  const header = new Map<string, string>()
  for (const line of lines) {
    if (line.trim() === '') break
    const m = /^(\w+):\s*(.*)$/.exec(line)
    if (m?.[1] !== undefined && m[2] !== undefined) header.set(m[1], m[2].trim())
  }
  const language = header.get('CrashLang') || undefined
  const signal = header.get('CrashReason') || undefined
  if (!language && !signal) return undefined

  const start = lines.indexOf(START)
  const end = lines.indexOf(END, start + 1)
  const section = start === -1 ? [] : lines.slice(start + 1, end === -1 ? undefined : end)
  const message = section.find((l) => /^\w*Error: /.test(l))
  const stack = section.filter((l) => /^\s+at /.test(l)).map((l) => l.trim())
  return {
    ...(language ? { language } : {}),
    ...(signal ? { signal } : {}),
    ...(message ? { message } : {}),
    stack
  }
}
