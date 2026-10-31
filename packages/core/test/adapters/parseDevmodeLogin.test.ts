import { describe, expect, test } from 'vitest'
import { parseDevmodeLogin, parseDevmodeLoginPrompt, parseDevmodeResult } from '../../src/index.js'
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

describe('parseDevmodeLoginPrompt', () => {
  test.each([
    'vega-devmode-login/signed-out.json',
    'vega-devmode-login/signed-in-after-browser.json'
  ])('%s has the URL and code', (file) => {
    expect(parseDevmodeLoginPrompt(fixture(`0.24/${file}`))).toEqual({
      verificationUri: 'https://amazon.com/us/code?cbl-code=ABC123',
      userCode: 'ABC123'
    })
  })

  test.each([
    ['nothing printed yet', ''],
    ['half an object', '{\n  "status": "pending",\n  "verificationUri": "https://amazon.com'],
    ['signed in', fixture('0.24/vega-devmode-login/signed-in.json')],
    [
      'a link that is not https',
      '{"status":"pending","verificationUri":"file:///etc/passwd","userCode":"ABC123"}'
    ]
  ])('null for %s', (_name, out) => {
    expect(parseDevmodeLoginPrompt(out)).toBeNull()
  })
})

describe('parseDevmodeResult', () => {
  test.each([
    ['vega-devmode-login/signed-in-after-browser.json', { ok: true }],
    ['vega-devmode-enable-device/enabled.json', { ok: true }],
    [
      'vega-devmode-enable-device/invalid-code.json',
      { ok: false, errorCode: 6, message: 'Invalid code' }
    ],
    [
      'vega-devmode-enable-device/not-signed-in.json',
      {
        ok: false,
        errorCode: 2,
        message: "Authentication required. Run 'vega devmode login' first"
      }
    ]
  ])('%s', (file, expected) => {
    expect(parseDevmodeResult('vega devmode', fixture(`0.24/${file}`))).toEqual(expected)
  })

  test.each(['', 'Error: Invalid code', '{"status":"pending"}'])('rejects %j', (out) => {
    expect(() => parseDevmodeResult('vega devmode', out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
