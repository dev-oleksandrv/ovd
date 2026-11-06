import { describe, expect, test } from 'vitest'
import { parseVlcmList } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseVlcmList', () => {
  test('the player running', () => {
    const entries = parseVlcmList(fixture('0.24/vlcm-list/virtual-device-player-running.txt'))
    expect(entries).toHaveLength(9)
    expect(entries.find((e) => e.application === 'com.example.player.main')).toEqual({
      application: 'com.example.player.main',
      type: 'I',
      pid: expect.any(Number),
      state: 'VISIBLE',
      lifespan: 'PERMANENT',
      container: expect.stringMatching(/^framework\.slice\//)
    })
  })

  test('the player stopped', () => {
    const entries = parseVlcmList(fixture('0.24/vlcm-list/virtual-device-player-stopped.txt'))
    expect(entries).toHaveLength(8)
    expect(entries.some((e) => e.application.startsWith('com.example.'))).toBe(false)
  })

  test('a stick: system services and the launcher', () => {
    const entries = parseVlcmList(fixture('0.24/vlcm-list/stick.txt'))
    expect(entries).toHaveLength(21)
    expect(entries.filter((e) => e.type === 'I').map((e) => e.state)).toEqual([
      'VISIBLE',
      'VISIBLE'
    ])
  })

  test.each([
    ['one app running', 'vlcm-list/app-running.txt', 1],
    ['an app that isn’t running or installed: the header only', 'vlcm-list/app-missing.txt', 0]
  ])('%s', (_name, file, count) => {
    expect(parseVlcmList(fixture(`0.24/${file}`))).toHaveLength(count)
  })

  test.each([
    ['empty output', ''],
    ['an error', 'vda: device offline'],
    [
      'a row without a pid',
      'application type pid id state lifespan timeout container launch args\ncom.example.player.main I x 1 VISIBLE PERMANENT n/a c <none>'
    ]
  ])('%s', (_name, out) => {
    expect(() => parseVlcmList(out)).toThrow(expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' }))
  })
})
