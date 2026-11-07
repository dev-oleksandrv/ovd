import { describe, expect, test } from 'vitest'
import { APP_ID_HINT, assertAppId, type AppIdSource } from '../../src/deviceApps/appId.js'
import type { OvdError } from '../../src/index.js'

const ARGUMENT: AppIdSource = { from: 'argument' }

function refused(id: string, source: AppIdSource = ARGUMENT): OvdError {
  try {
    assertAppId(id, source)
  } catch (error) {
    return error as OvdError
  }
  throw new Error(`expected ${id} to be refused`)
}

describe('assertAppId', () => {
  test.each([
    'com.example.player',
    'com.example.player.main',
    'com.example.player.debug',
    'com.example.hello-vega',
    'com.example.hello_vega',
    'Player2'
  ])('%s is an app ID', (id) => {
    expect(assertAppId(id, ARGUMENT)).toBe(id)
  })

  test.each([
    '',
    'x;rm -rf ~',
    'com.example.player; reboot',
    'com.example.$(id)',
    'com.example.`id`',
    "com.example.'player'",
    'com.example."player"',
    'com.example.player && ls',
    'com.example.player | cat',
    'com example player',
    'com.example.player\nreboot',
    '-rf',
    '.hidden',
    '_player',
    'com/example/player',
    'com.example.(player)'
  ])('%j is refused', (id) => {
    expect(refused(id)).toMatchObject({ code: 'INVALID_APP_ID', hint: APP_ID_HINT })
  })

  test.each<[AppIdSource, string]>([
    [ARGUMENT, '"x;rm" isn’t an app ID'],
    [
      { from: 'manifest', folder: '~/dev/player' },
      'The package ID in ~/dev/player/manifest.toml isn’t an app ID: "x;rm"'
    ],
    [
      { from: 'vpkg', file: 'player_armv7.vpkg' },
      'The package ID in player_armv7.vpkg isn’t an app ID: "x;rm"'
    ],
    [
      { from: 'device', device: 'Vega Virtual Device' },
      'Vega Virtual Device reported an ID that isn’t an app ID: "x;rm"'
    ]
  ])('the message names where the ID came from: %j', (source, message) => {
    expect(refused('x;rm', source).message).toBe(message)
  })

  test('a newline in the ID is escaped in the message', () => {
    expect(refused('a\nb').message).toBe('"a\\nb" isn’t an app ID')
  })
})
