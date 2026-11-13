import { describe, expect, test } from 'vitest'
import {
  ageText,
  buildText,
  crashesBlocker,
  crashesCli,
  crashPullCli,
  crashSummary,
  crashToastText,
  detailRows,
  metaLine
} from '../../../../src/renderer/src/screens/crashes/crashesView'
import { stick, vvd, wifiOffline } from '../devices/sample'
import { jsCrash, nativeCrash } from './sample'

const now = new Date('2026-11-13T10:00:30.000Z')

describe('crashesView', () => {
  test('the CLI echoes are the commands core runs', () => {
    expect(crashesCli('VirtualDevice')).toBe('ovd crashes --device VirtualDevice')
    expect(crashPullCli(2100, 'VirtualDevice')).toBe('ovd crash pull 2100 --device VirtualDevice')
  })

  test('a device id with shell metacharacters is quoted in both echoes', () => {
    const evil = 'x;printf${IFS}INJECTED'
    expect(crashesCli(evil)).toBe("ovd crashes --device 'x;printf${IFS}INJECTED'")
    expect(crashPullCli(7, evil)).toBe("ovd crash pull 7 --device 'x;printf${IFS}INJECTED'")
    expect(crashesCli("a'b")).toBe("ovd crashes --device 'a'\\''b'")
  })

  test('the blocker is no target, offline, or none', () => {
    expect(crashesBlocker(undefined)).toBe('no-target')
    expect(crashesBlocker(wifiOffline)).toBe('offline')
    expect(crashesBlocker(stick)).toBeNull()
    expect(crashesBlocker(vvd)).toBe(vvd.status === 'online' ? null : 'offline')
  })

  test.each([
    ['2026-11-13T10:00:28.000Z', 'just now'],
    ['2026-11-13T10:00:00.000Z', '30 s ago'],
    ['2026-11-13T09:55:30.000Z', '5 min ago'],
    ['2026-11-13T07:00:30.000Z', '3 h ago'],
    ['not a time', '—']
  ])('age of %s is %s', (iso, text) => {
    expect(ageText(iso, now)).toBe(text)
  })

  test('the summary falls back to the signal', () => {
    expect(crashSummary(jsCrash)).toBe('Error: player deliberate crash')
    const bare = { ...nativeCrash, summary: undefined }
    expect(crashSummary(bare)).toBe('SIGSEGV')
    expect(crashSummary({ ...bare, signalName: undefined })).toBe('signal 11')
  })

  test('build and the meta line', () => {
    expect(buildText(jsCrash)).toBe('1.4.2 (142)')
    expect(buildText({ ...jsCrash, build: undefined })).toBe('1.4.2')
    expect(buildText({ ...jsCrash, version: undefined })).toBe('build 142')
    expect(buildText({ ...jsCrash, version: undefined, build: undefined })).toBe('—')
    expect(metaLine(jsCrash, 'Fire TV stick')).toBe('pid 3200 · 1.4.2 (142) · Fire TV stick')
  })

  test('the toast text is "<app> crashed · <summary>"', () => {
    expect(crashToastText(jsCrash)).toBe(
      'com.example.player crashed · Error: player deliberate crash'
    )
  })

  test('the detail rows', () => {
    const rows = detailRows(jsCrash, now)
    expect(rows.map((r) => r.label)).toEqual(['Crash id', 'Process', 'Signal', 'Time', 'Version'])
    expect(rows.find((r) => r.label === 'Signal')?.value).toBe('6 · SIGABRT')
  })
})
