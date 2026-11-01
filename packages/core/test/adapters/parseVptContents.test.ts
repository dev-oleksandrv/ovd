import { describe, expect, test } from 'vitest'
import { parseVptContents } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseVptContents', () => {
  test.each([
    ['vpt-show-contents/player-armv7.txt', 'armv7'],
    ['vpt-show-contents/player-aarch64.txt', 'aarch64'],
    // Pure JS: no native libraries, so no architecture of its own.
    ['vpt-show-contents/hellovega.txt', 'any']
  ])('%s', (file, architecture) => {
    expect(parseVptContents(fixture(`0.24/${file}`))).toEqual({ architecture })
  })

  test.each([
    ['empty output', '', 'any'],
    ['x86_64 library', 'manifest.toml\nlib/x86_64/libfoo.so', 'x86_64'],
    ['two architectures', 'lib/armv7/libfoo.so\nlib/aarch64/libfoo.so', 'unknown'],
    ['unrecognized folder', 'lib/riscv64/libfoo.so', 'unknown']
  ])('%s', (_name, out, architecture) => {
    expect(parseVptContents(out)).toEqual({ architecture })
  })
})
