import { describe, expect, test } from 'vitest'
import { GRPC_KEYS, INPUTD_KEYS, isRemoteKey, REMOTE_KEYS } from '../../src/input/keys.js'

describe('remote keys', () => {
  test.each([
    ['up', 'KEY_UP', 103],
    ['down', 'KEY_DOWN', 108],
    ['left', 'KEY_LEFT', 105],
    ['right', 'KEY_RIGHT', 106],
    ['ok', 'KEY_ENTER', 96],
    ['back', 'KEY_BACK', 158],
    ['home', 'KEY_HOMEPAGE', undefined],
    ['menu', 'KEY_MENU', 139],
    ['play-pause', 'KEY_PLAYPAUSE', 164],
    ['rewind', 'KEY_REWIND', 168],
    ['fast-forward', 'KEY_FASTFORWARD', 208]
  ] as const)('%s → inputd-cli %s, gRPC evdev %s', (key, inputd, grpc) => {
    expect(INPUTD_KEYS[key]).toBe(inputd)
    expect(GRPC_KEYS[key]).toBe(grpc)
  })

  test('every key has an inputd-cli name; only Home lacks a gRPC code', () => {
    expect(Object.keys(INPUTD_KEYS).sort()).toEqual([...REMOTE_KEYS].sort())
    expect(REMOTE_KEYS.filter((k) => GRPC_KEYS[k] === undefined)).toEqual(['home'])
  })

  test.each([
    ['up', true],
    ['play-pause', true],
    ['UP', false],
    ['KEY_UP', false],
    ['', false]
  ])('isRemoteKey(%j) is %s', (value, expected) => {
    expect(isRemoteKey(value)).toBe(expected)
  })
})
