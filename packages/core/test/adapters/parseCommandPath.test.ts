import { describe, expect, test } from 'vitest'
import { parseCommandPath } from '../../src/index.js'

describe('parseCommandPath', () => {
  test.each([
    ['the path line', '/home/dev/vega/bin/vega\n', '/home/dev/vega/bin/vega'],
    // An interactive login shell can print its own lines (a greeting, a prompt theme) first.
    [
      'the last path after shell output',
      'Welcome back\n/etc/motd is empty\n/home/dev/vega/sdk/0.24.12112/bin/vega\n',
      '/home/dev/vega/sdk/0.24.12112/bin/vega'
    ],
    ['nothing when not found', '', undefined],
    ['nothing for an alias', "alias vega='/home/dev/vega/bin/vega'\n", undefined],
    ['nothing for a function', 'vega\n', undefined]
  ])('reads %s', (_name, stdout, expected) => {
    expect(parseCommandPath(stdout)).toBe(expected)
  })
})
