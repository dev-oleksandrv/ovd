import { expect, test } from 'vitest'
import { atLeast, levelOf, parseLevelName } from '../../src/logs/logLevel.js'

test.each([
  ['emerg', 'E'],
  ['alert', 'E'],
  ['crit', 'E'],
  ['err', 'E'],
  ['warning', 'W'],
  ['notice', 'I'],
  ['info', 'I'],
  ['debug', 'D'],
  ['chatty', 'I']
])('priority %s is level %s', (priority, level) => {
  expect(levelOf(priority)).toBe(level)
})

test.each([
  ['v', 'V'],
  ['verbose', 'V'],
  ['d', 'D'],
  ['DEBUG', 'D'],
  ['i', 'I'],
  ['info', 'I'],
  ['W', 'W'],
  ['warn', 'W'],
  ['e', 'E'],
  ['Error', 'E']
])('level name %s is %s', (name, level) => {
  expect(parseLevelName(name)).toBe(level)
})

test.each(['warning', 'fatal', '', 'x'])('%j is not a level name', (name) => {
  expect(() => parseLevelName(name)).toThrow(
    expect.objectContaining({ code: 'INVALID_LOG_FILTER' })
  )
})

test('V keeps everything and E only errors', () => {
  expect(atLeast('D', 'V')).toBe(true)
  expect(atLeast('W', 'E')).toBe(false)
  expect(atLeast('E', 'E')).toBe(true)
  expect(atLeast('I', 'W')).toBe(false)
})
