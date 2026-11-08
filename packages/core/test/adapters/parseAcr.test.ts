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
})
