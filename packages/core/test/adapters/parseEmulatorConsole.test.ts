import { describe, expect, test } from 'vitest'
import {
  consoleReplyDone,
  isConsoleGreeting,
  parseConsoleReply,
  parseGrpcEnabled
} from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

const consoleFixture = (name: string) => fixture(`0.24/emulator-console/${name}`)

describe('consoleReplyDone', () => {
  test.each([
    'greeting.txt',
    'auth-ok.txt',
    'auth-bad.txt',
    'unknown-command.txt',
    'grpc-enabled.txt'
  ])('%s is a complete reply', (name) => {
    expect(consoleReplyDone(consoleFixture(name))).toBe(true)
  })

  test('a reply cut before its OK line is not complete', () => {
    const text = consoleFixture('grpc-enabled.txt')
    expect(consoleReplyDone(text.slice(0, text.lastIndexOf('OK')))).toBe(false)
    // An `OK:` line, or a KO line still arriving, ends nothing.
    expect(consoleReplyDone('OK: { "port": "8554" }\r\n')).toBe(false)
    expect(consoleReplyDone('KO: authentication')).toBe(false)
    expect(consoleReplyDone('')).toBe(false)
  })
})

describe('parseConsoleReply', () => {
  test.each([
    ['auth-ok.txt', { ok: true, lines: ["Android Console: type 'help' for a list of commands"] }],
    [
      'auth-bad.txt',
      {
        ok: false,
        lines: [],
        error: 'authentication token does not match ~/.emulator_console_auth_token'
      }
    ],
    ['unknown-command.txt', { ok: false, lines: [], error: "unknown command, try 'help'" }],
    [
      'grpc-enabled.txt',
      {
        ok: true,
        lines: ['OK: { "port": "8554" }', 'OK: gRPC endpoint available at port 8554']
      }
    ]
  ])('%s', (name, expected) => {
    expect(parseConsoleReply(consoleFixture(name))).toEqual(expected)
  })

  test('an incomplete reply is unexpected output', () => {
    expect(() => parseConsoleReply('Android Console: Authentication required\r\n')).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})

describe('isConsoleGreeting', () => {
  test.each([
    [consoleFixture('greeting.txt'), true],
    ['SSH-2.0-OpenSSH_9.6\r\n', false],
    ['HTTP/1.1 400 Bad Request\r\n', false],
    ['', false]
  ])('%j', (text, expected) => {
    expect(isConsoleGreeting(text)).toBe(expected)
  })
})

describe('parseGrpcEnabled', () => {
  test('reads the port', () => {
    expect(parseGrpcEnabled(consoleFixture('grpc-enabled.txt'))).toEqual({ port: 8554 })
  })

  test.each(['unknown-command.txt', 'auth-ok.txt'])('rejects %s', (name) => {
    expect(() => parseGrpcEnabled(consoleFixture(name))).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})
