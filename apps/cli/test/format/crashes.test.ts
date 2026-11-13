import type { Crash } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import {
  ageText,
  crashesTable,
  crashLine,
  escapeControls,
  noteJson,
  noteText
} from '../../src/format/crashes.js'

const crash: Crash = {
  id: 105,
  package: 'com.example.player',
  kind: 'js',
  signal: 6,
  pid: 7746,
  time: '2026-11-12T09:00:00.000Z',
  version: '0.1.0',
  build: '1',
  summary: 'Error: boom',
  new: true
}
const now = new Date('2026-11-12T09:05:30.000Z')

describe('crash formatting', () => {
  test('one aligned line per report, no trailing spaces', () => {
    const text = crashesTable(
      {
        device: 'Vega Virtual Device',
        crashes: [crash, { ...crash, id: 7, new: false, kind: 'native', summary: undefined }]
      },
      now
    )
    expect(text).toBe(
      [
        '105  js      com.example.player  NEW  5 min ago  pid 7746 · 0.1.0 (1)  Error: boom',
        '7    native  com.example.player       5 min ago  pid 7746 · 0.1.0 (1)'
      ].join('\n') + '\n'
    )
  })

  test('an empty list says so, with the device name', () => {
    expect(crashesTable({ device: 'Living room stick', crashes: [] })).toBe(
      'No crashes of your apps on Living room stick.\n'
    )
  })

  test('multi-line and control characters of device text stay on one visible line', () => {
    const line = crashLine({ ...crash, summary: 'a\nb\u001b[31m' }, now)
    expect(line.trimEnd().split('\n')).toHaveLength(1)
    expect(line).toContain('a b\\x1b[31m')
  })

  test('escapeControls is the `ovd logs` escape', () => {
    expect(escapeControls('a\tb\u0007\u009f\u2067')).toBe('a\tb\\x07\\x9f\\u{2067}')
  })

  test('ages', () => {
    const at = (s: number) => ageText(new Date(now.getTime() - s * 1000).toISOString(), now)
    expect([at(5), at(120), at(7200), at(172_800), at(-30)]).toEqual([
      'just now',
      '2 min ago',
      '2 h ago',
      '2 d ago',
      'just now'
    ])
  })

  test('OVD lines have the shape ovd logs uses', () => {
    const time = '2026-11-12T09:05:30.123Z'
    expect(noteJson('away', 'gone', time)).toEqual({
      time,
      ovd: { kind: 'disconnected' },
      message: 'gone'
    })
    expect(noteText('back', 'again', time)).toMatch(/^\d\d:\d\d:\d\d\.123 OVD again\n$/)
  })
})
