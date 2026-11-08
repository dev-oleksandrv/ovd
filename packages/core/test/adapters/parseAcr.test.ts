import { describe, expect, test } from 'vitest'
import { parseAcr } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseAcr', () => {
  test.each([['virtual-device-crashed'], ['stick-crashed']])('%s', (name) => {
    const acr = parseAcr(fixture(`0.24/loggingctl-vault-acr/${name}.txt`))
    expect(acr).toEqual({
      language: 'JavaScript',
      signal: 'SIGABRT',
      message: 'Error: player: deliberate crash right after launch',
      stack: [expect.stringMatching(/^at anonymous \(.*\.bundle:652:20\)$/)]
    })
  })

  test.each([
    [
      'a refused read (status -7)',
      fixture('0.24/loggingctl-vault-acr/insufficient-permissions.json')
    ],
    // What an unknown index prints (fixtures/0.24/README.md, the insufficient-permissions row).
    ['an unknown index (status -8)', 'No entry found for tag SYSTEM_TOMBSTONE\n'],
    ['empty output', '']
  ])('%s: undefined', (_name, out) => {
    expect(parseAcr(out)).toBeUndefined()
  })

  // The recorded report with escape sequences the app could have put in its error and stack.
  test('control characters are removed from the header, the message and the stack', () => {
    const recorded = fixture('0.24/loggingctl-vault-acr/virtual-device-crashed.txt')
    const tampered = recorded
      .replace('CrashLang: JavaScript', 'CrashLang: Java\u0007Script')
      .replace('CrashReason: SIGABRT', 'CrashReason: SIGABRT\u009b')
      .replace(
        'Error: player: deliberate crash right after launch',
        'Error: player:\t\u001b]0;pwned\u0007\u001b[2Jdeliberate crash right after launch'
      )
      .replace(/^(\s+at anonymous) /m, '$1\u009d0;x\u009c ')
    expect(tampered).not.toBe(recorded)

    expect(parseAcr(tampered)).toEqual({
      language: 'JavaScript',
      signal: 'SIGABRT',
      message: 'Error: player:\t]0;pwned[2Jdeliberate crash right after launch',
      stack: [expect.stringMatching(/^at anonymous0;x \(.*\.bundle:652:20\)$/)]
    })
  })
})
