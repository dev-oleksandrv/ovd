import { describe, expect, test } from 'vitest'
import {
  inputdReplyBody,
  inputdReplyDone,
  inputdWelcomeDone,
  parseInputdPress,
  parseInputdText
} from '../../src/adapters/parseInputdReply.js'
import { fixture } from '../support/fixtures.js'

// Recorded on the Virtual Device, SDK 0.24.12112 (fixtures/0.24/README.md).
const recorded = (name: string) => fixture(`0.24/inputd-cli-console/${name}`)

describe('inputd-cli console prompts', () => {
  test('the welcome ends at its first prompt', () => {
    const welcome = recorded('welcome.txt')
    expect(inputdWelcomeDone(welcome)).toBe(true)
    expect(inputdWelcomeDone(welcome.slice(0, -2))).toBe(false)
    expect(inputdReplyDone(welcome)).toBe(false)
  })

  test.each([
    'button-press.txt',
    'send-text.txt',
    'invalid-button.txt',
    'send-text-unquoted-space.txt'
  ])('%s is a complete reply', (name) => {
    expect(inputdReplyDone(recorded(name))).toBe(true)
  })

  test('a text that contains the prompt doesn’t end the reply early', () => {
    const chunk = 'Injecting Text: inputd-cli > '
    expect(inputdReplyDone(chunk)).toBe(false)
    expect(inputdReplyDone(`${chunk}\n\r\ninputd-cli > `)).toBe(true)
    expect(inputdReplyBody(`${chunk}\n\r\ninputd-cli > `)).toBe(chunk)
  })

  test('exit prints no prompt', () => {
    expect(inputdReplyDone(recorded('exit.txt'))).toBe(false)
  })
})

describe('parseInputdPress', () => {
  test.each([
    ['button-press.txt', 'KEY_UP', { ok: true }],
    ['button-press-enter.txt', 'KEY_ENTER', { ok: true }],
    // Another key's confirmation isn't this key's.
    ['button-press.txt', 'KEY_DOWN', { ok: false, message: expect.any(String) }],
    ['invalid-button.txt', 'KEY_NOPE', { ok: false, message: 'invalid button value: [KEY_NOPE]' }],
    ['exit.txt', 'KEY_UP', { ok: false, message: 'exiting...' }]
  ])('%s for %s', (name, key, expected) => {
    expect(parseInputdPress(recorded(name), key)).toEqual(expected)
  })

  test('an empty reply', () => {
    expect(parseInputdPress('\n\r\ninputd-cli > ', 'KEY_UP')).toEqual({
      ok: false,
      message: 'inputd-cli gave no answer'
    })
  })
})

describe('parseInputdText', () => {
  test.each([
    ['send-text.txt', { ok: true }],
    ['send-text-escaped.txt', { ok: true }],
    [
      'send-text-unquoted-space.txt',
      { ok: false, message: 'send_text provided with an invalid number of arguments' }
    ],
    ['invalid-button.txt', { ok: false, message: 'inputd-cli didn’t accept the text' }]
  ])('%s', (name, expected) => {
    expect(parseInputdText(recorded(name))).toEqual(expected)
  })

  test('a failure never carries the reply, which may echo the text', () => {
    const reply = 'something went wrong with hunter2\n\r\ninputd-cli > '
    expect(JSON.stringify(parseInputdText(reply))).not.toContain('hunter2')
  })
})
