import { describe, expect, test } from 'vitest'
import { parseDevmodeLogin } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseDevmodeLogin', () => {
  test.each([
    ['vega-devmode-login/signed-in.json', { signedIn: true }],
    ['vega-devmode-login/signed-out.json', { signedIn: false, pending: true }]
  ])('%s', (file, expected) => {
    expect(parseDevmodeLogin(fixture(`0.24/${file}`))).toEqual(expected)
  })

  test('reads the first JSON object when a stopped process left trailing text', () => {
    const out = `${fixture('0.24/vega-devmode-login/signed-out.json')}\nWaiting for auth`
    expect(parseDevmodeLogin(out)).toEqual({ signedIn: false, pending: true })
  })

  test.each(['', 'nope', '{"status":"error","errorCode":3}'])('rejects %j', (out) => {
    expect(() => parseDevmodeLogin(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
