import { describe, expect, test } from 'vitest'
import { hello } from '../src/index.js'

describe('hello', () => {
  test('returns an ok result with a message', () => {
    expect(hello()).toEqual({ ok: true, message: 'OVD core is alive' })
  })
})
