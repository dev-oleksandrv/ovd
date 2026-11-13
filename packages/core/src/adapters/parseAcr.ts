import { stripControl } from './stripControl.js'

// What OVD reads from a crash report (ACR): its header and its JS stack
// (fixtures/0.24/loggingctl-vault-acr).
export interface AcrSummary {
  // `CrashLang` (`JavaScript`).
  language?: string
  // `CrashReason` (`SIGABRT`).
  signal?: string
  // `AppVersion` and `AppBuildNumber`, as printed.
  version?: string
  build?: string
  // The first `…Error: …` line of the JS stack.
  message?: string
  // The `at …` frames, trimmed.
  stack: string[]
}

// The host keeps at most this much of what the device printed (the bounded `sed` output is a
// few hundred bytes normally), so a hostile report can't make OVD parse or hold megabytes.
export const ACR_CAPTURE_MAX_BYTES = 64 * 1024
// Header values are short; a longer one is cut.
const VALUE_MAX = 200

const START = '<non_native_stack_trace>'
const END = '</non_native_stack_trace>'

// The bounded `sed` output: `Key: Value` lines up to the first blank line, then the
// `<non_native_stack_trace>` section. Enrichment only: anything else (a refused read, an
// unknown index) gives `undefined`, never an error.
//
// The cap is applied here, to what the runner already captured: bounding the capture itself
// (before it is held in memory) belongs to the runner and is out of scope for this parser.
export function parseAcr(stdout: string): AcrSummary | undefined {
  const capped = truncateUtf8(stdout, ACR_CAPTURE_MAX_BYTES)
  const lines = capped.replace(/\r\n/g, '\n').split('\n')
  const header = new Map<string, string>()
  for (const line of lines) {
    if (line.trim() === '') break
    const m = /^(\w+):\s*(.*)$/.exec(line)
    if (m?.[1] !== undefined && m[2] !== undefined) header.set(m[1], m[2].trim())
  }
  // The app writes the message and the stack; the surfaces print them (stripControl).
  const language = stripControl(header.get('CrashLang') ?? '').trim() || undefined
  const signal = stripControl(header.get('CrashReason') ?? '').trim() || undefined
  if (!language && !signal) return undefined
  const value = (key: string) =>
    stripControl(header.get(key) ?? '')
      .trim()
      .slice(0, VALUE_MAX) || undefined
  const version = value('AppVersion')
  const build = value('AppBuildNumber')

  const start = lines.indexOf(START)
  const end = lines.indexOf(END, start + 1)
  const section = start === -1 ? [] : lines.slice(start + 1, end === -1 ? undefined : end)
  const found = section.find((l) => /^\w*Error: /.test(l))
  const message = found === undefined ? undefined : stripControl(found)
  const stack = section.filter((l) => /^\s+at /.test(l)).map((l) => stripControl(l).trim())
  return {
    ...(language ? { language } : {}),
    ...(signal ? { signal } : {}),
    ...(version ? { version } : {}),
    ...(build ? { build } : {}),
    ...(message ? { message } : {}),
    stack
  }
}

// At most `maxBytes` of the text as UTF-8, cut on a character boundary.
export function truncateUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.length <= maxBytes) return text
  let end = maxBytes
  // The first byte left out is a continuation byte: its character straddles the cut, drop it.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString('utf8')
}
