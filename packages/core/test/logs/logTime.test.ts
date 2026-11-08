import { describe, expect, test } from 'vitest'
import { deviceInstant, parseLogTime } from '../../src/logs/logTime.js'

describe('deviceInstant', () => {
  test.each([
    ['Nov 08 07:27:00.257342', '2026-11-08T12:00:00Z', '2026-11-08T07:27:00.257Z'],
    ['Dec 31 23:59:59.000000', '2027-01-01T00:00:30Z', '2026-12-31T23:59:59.000Z'],
    ['Jan 01 00:00:10.000000', '2026-12-31T23:59:50Z', '2027-01-01T00:00:10.000Z'],
    ['Nov 09 07:00:00.000000', '2026-11-08T12:00:00Z', '2026-11-09T07:00:00.000Z'],
    ['Nov 10 07:00:00.000000', '2026-11-08T12:00:00Z', '2025-11-10T07:00:00.000Z']
  ])('%s at %s is %s', (deviceTime, now, expected) => {
    expect(deviceInstant(deviceTime, new Date(now))?.toISOString()).toBe(expected)
  })

  test('something else is not a device time', () => {
    expect(deviceInstant('Foo 08 07:27:00.1', new Date())).toBeUndefined()
  })
})

describe('parseLogTime', () => {
  const now = new Date('2026-11-08T12:00:00Z')
  const today = (h: number, m: number, s = 0) => {
    const d = new Date(now)
    d.setHours(h, m, s, 0)
    return d.getTime()
  }

  test.each([
    ['2026-11-08T07:27:00Z', Date.parse('2026-11-08T07:27:00Z')],
    ['2026-11-08T07:27:00.5Z', Date.parse('2026-11-08T07:27:00.500Z')],
    ['2026-11-08T09:27:00+02:00', Date.parse('2026-11-08T07:27:00Z')],
    ['2026-11-08T07:27', new Date(2026, 10, 8, 7, 27).getTime()],
    ['2026-11-08 07:27:30', new Date(2026, 10, 8, 7, 27, 30).getTime()],
    ['07:27', today(7, 27)],
    ['7:27:15', today(7, 27, 15)],
    ['30s', now.getTime() - 30_000],
    ['5m', now.getTime() - 300_000],
    ['2h', now.getTime() - 7_200_000]
  ])('%s', (text, expected) => {
    expect(parseLogTime(text, now, 'since').getTime()).toBe(expected)
  })

  test.each(['yesterday', '25:00', '2026-13-40T00:00', '5d', '', '12:61'])(
    '%j is not a time',
    (text) => {
      expect(() => parseLogTime(text, now, 'until')).toThrow(
        expect.objectContaining({
          code: 'INVALID_LOG_FILTER',
          message: expect.stringContaining('--until')
        })
      )
    }
  )
})
