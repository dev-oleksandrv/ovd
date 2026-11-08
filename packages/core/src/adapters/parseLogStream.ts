import { z } from 'zod'
import { levelOf } from '../logs/logLevel.js'
import { deviceInstant } from '../logs/logTime.js'
import type { LogEntry } from '../logs/types.js'
import { stripControl } from './stripControl.js'

// `loggingctl log -f -o short_concise` (ARCHITECTURE §8; fixtures/0.24/loggingctl-log/
// stick-follow.txt, stick-follow-debug-stack.txt, stick-follow-rate-limit.txt,
// stick-follow-reboot.txt): `<Mon DD HH:MM:SS.ffffff> <host> <facility>.<priority>
// <identity>[<pid>]: <tid> <message>`. Continuation lines of a multi-line message have no
// header; journald's own lines have no tid. No JSON mode, so this parser stays small.
const HEADER =
  /^([A-Z][a-z]{2} {1,2}\d{1,2} \d{2}:\d{2}:\d{2}\.\d{1,6}) (\S+) ([\w-]+)\.(\w+) (.*)$/
const REST = /^([^\s[]+)\[(\d+)\]: (.*)$/
const TID = /^(\d+) (.*)$/
// `<level word> <tag>:` after the tid (`I resmgr-app-registry:[…]`, `INFO com.amazon.keplerscript:`).
const TAGGED = /^(?:V|D|I|W|E|F|VERBOSE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL) ([^\s:]+):(.*)$/

export const LogEntrySchema = z.object({
  seq: z.number().int().nonnegative(),
  time: z.iso.datetime(),
  deviceTime: z.string().nullable(),
  level: z.enum(['D', 'I', 'W', 'E']),
  priority: z.string().nullable(),
  facility: z.string().nullable(),
  process: z.string().nullable(),
  pid: z.number().int().nonnegative().nullable(),
  tid: z.number().int().nonnegative().nullable(),
  tag: z.string(),
  message: z.string(),
  parsed: z.boolean()
})

export interface LogStreamParser {
  // The entries a chunk completed. The latest entry is held until the next header, because
  // continuation lines follow their entry.
  push(chunk: string): LogEntry[]
  // Emits the held entry (the session calls it when the stream goes quiet).
  flush(): LogEntry[]
  // The stream ended: also takes an unfinished last line.
  end(): LogEntry[]
}

type Draft = Omit<LogEntry, 'seq' | 'message'> & { lines: string[] }

// Never throws and never drops a line: anything it can't read becomes a `parsed: false` entry.
export function createLogStreamParser(opts: { now: () => Date }): LogStreamParser {
  let pending = ''
  let held: Draft | undefined
  // The last emitted entry, for a continuation line that arrives after a flush.
  let last: Draft | undefined
  let seq = 0

  const emit = (draft: Draft): LogEntry => {
    const entry: LogEntry = {
      seq: seq++,
      time: draft.time,
      deviceTime: draft.deviceTime,
      level: draft.level,
      priority: draft.priority,
      facility: draft.facility,
      process: draft.process,
      pid: draft.pid,
      tid: draft.tid,
      tag: draft.tag,
      message: draft.lines.join('\n'),
      parsed: draft.parsed
    }
    if (LogEntrySchema.safeParse(entry).success) return entry
    return { ...rawDraftEntry(entry.message, opts.now()), seq: entry.seq }
  }

  const releaseHeld = (out: LogEntry[]) => {
    if (!held) return
    out.push(emit(held))
    last = held
    held = undefined
  }

  const line = (text: string, out: LogEntry[]) => {
    const clean = stripControl(text)
    const header = headerDraft(clean, opts.now())
    if (header) {
      releaseHeld(out)
      held = header
      return
    }
    if (held) {
      held.lines.push(clean)
      return
    }
    if (last) {
      held = { ...last, lines: [clean] }
      return
    }
    out.push({ ...rawDraftEntry(clean, opts.now()), seq: seq++ })
  }

  return {
    push(chunk) {
      const out: LogEntry[] = []
      const parts = (pending + chunk).split('\n')
      pending = parts.pop() ?? ''
      for (const part of parts) line(part, out)
      return out
    },
    flush() {
      const out: LogEntry[] = []
      releaseHeld(out)
      return out
    },
    end() {
      const out: LogEntry[] = []
      if (pending !== '') line(pending, out)
      pending = ''
      releaseHeld(out)
      return out
    }
  }
}

function headerDraft(text: string, now: Date): Draft | undefined {
  const m = HEADER.exec(text)
  if (!m) return undefined
  const [, deviceTime = '', , facility = '', priority = '', rest = ''] = m
  const instant = deviceInstant(deviceTime, now) ?? now
  const base = {
    time: instant.toISOString(),
    deviceTime,
    level: levelOf(priority),
    priority,
    facility,
    parsed: true
  }
  const r = REST.exec(rest)
  if (!r) return { ...base, process: null, pid: null, tid: null, tag: '', lines: [rest] }
  const [, identity = '', pid = '', body = ''] = r
  const t = TID.exec(body)
  const tid = t ? Number(t[1]) : null
  const text2 = t ? (t[2] ?? '') : dropSpace(body)
  const tagged = TAGGED.exec(text2)
  const tag = tagged ? (tagged[1] ?? identity) : identity
  const message = tagged ? dropSpace(tagged[2] ?? '') : text2
  return { ...base, process: identity, pid: Number(pid), tid, tag, lines: [message] }
}

function dropSpace(text: string): string {
  return text.startsWith(' ') ? text.slice(1) : text
}

function rawDraftEntry(message: string, now: Date): Omit<LogEntry, 'seq'> {
  return {
    time: now.toISOString(),
    deviceTime: null,
    level: 'I',
    priority: null,
    facility: null,
    process: null,
    pid: null,
    tid: null,
    tag: '',
    message,
    parsed: false
  }
}
