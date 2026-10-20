import { describe, expect, test } from 'vitest'
import { resolveOvdHome } from '../../src/index.js'

describe('resolveOvdHome', () => {
  test.each([
    [{ OVD_HOME: '/o' }, '/o'],
    [{ XDG_CONFIG_HOME: '/x' }, '/x/ovd'],
    [{}, '/h/.config/ovd'],
    [{ OVD_HOME: '/o', XDG_CONFIG_HOME: '/x' }, '/o']
  ])('%j → %s', (env, expected) => {
    expect(resolveOvdHome(env, '/h')).toBe(expected)
  })
})
