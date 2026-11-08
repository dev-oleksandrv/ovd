import { describe, expect, test } from 'vitest'
import { parseLogCapture } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseLogCapture', () => {
  test('the recorded start: the file and the timeout pid', () => {
    expect(parseLogCapture(fixture('0.24/log-capture/started.txt'))).toEqual({
      file: '/tmp/tmp.XXXXHeBy6l',
      pid: 2056
    })
  })

  test.each([
    ['a path outside mktemp’s', '/tmp/../etc 1'],
    ['shell characters', '/tmp/tmp.a;rm 1'],
    ['pid 0', '/tmp/tmp.a 0'],
    ['no pid', '/tmp/tmp.a x'],
    ['empty output', '']
  ])('%s: undefined', (_name, out) => {
    expect(parseLogCapture(out)).toBeUndefined()
  })
})
