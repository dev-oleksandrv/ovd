import { expect, test } from 'vitest'
import { logText, logTextAll } from '../../src/logs/logText.js'
import type { LogEntry } from '../../src/logs/types.js'

const TIME = '2026-11-08T07:27:00.257Z'
const d = new Date(TIME)
const two = (n: number) => String(n).padStart(2, '0')
const CLOCK = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.257`

const entry: LogEntry = {
  seq: 0,
  time: TIME,
  deviceTime: 'Nov 08 07:27:00.257342',
  level: 'E',
  priority: 'err',
  facility: 'local0',
  process: 'com.example.player',
  pid: 27178,
  tid: 2842092448,
  tag: 'com.amazon.keplerscript',
  message: '[KeplerScript-JavaScript] player error tick 1',
  parsed: true
}

test('one line: local time, level, padded tag, right-aligned pid, message', () => {
  expect(logText(entry)).toBe(
    `${CLOCK} E com.amazon.keplerscript   27178 [KeplerScript-JavaScript] player error tick 1\n`
  )
})

test('continuation lines are indented to the message column', () => {
  const text = logText({ ...entry, message: 'first\nline two' })
  const [head = '', second = ''] = text.split('\n')
  expect(second.trimStart()).toBe('line two')
  expect(second.length - 'line two'.length).toBe(head.length - 'first'.length)
})

test('a missing pid is a dash', () => {
  expect(logText({ ...entry, pid: null, tag: 'x' })).toBe(
    `${CLOCK} E ${'x'.padEnd(24)}      - [KeplerScript-JavaScript] player error tick 1\n`
  )
})

test('paintLevel wraps only the level letter', () => {
  const text = logText(entry, { paintLevel: (level, t) => `<${level}:${t}>` })
  expect(text.startsWith(`${CLOCK} <E:E> com.amazon.keplerscript `)).toBe(true)
})

test('logTextAll joins the lines', () => {
  expect(logTextAll([entry, entry])).toBe(logText(entry) + logText(entry))
})
