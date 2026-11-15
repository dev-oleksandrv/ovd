import { describe, expect, test } from 'vitest'
import { buildFileTree, type FileNode } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

// The tree as `name/` for folders, indented two spaces per level.
function outline(nodes: FileNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.name}${n.kind === 'folder' ? '/' : ''}`,
    ...outline(n.children ?? [], depth + 1)
  ])
}

describe('buildFileTree', () => {
  test('the recorded package: folders first, each level by name', () => {
    const entries = fixture('0.24/vpt-show-contents/player-aarch64-release.txt')
      .split('\n')
      .filter(Boolean)
    expect(outline(buildFileTree(entries))).toEqual([
      'assets/',
      '  raw/',
      '    keplerscript-app-config.json',
      '  asset-index.bin',
      '  kepler-sdk-version',
      'bundle/',
      '  assets/',
      '    src/',
      '      assets/',
      '        background.png',
      '        debug.png',
      '        get-started.png',
      '        home.png',
      '        learn-more.png',
      '        vega.png',
      '    app.json',
      '  index.bundle',
      '  index.hermes.bundle',
      'meta-info/',
      '  signature/',
      '    digest',
      '    digest.json',
      '    digest.json.sig',
      '    digest.sig',
      '  build-info.json',
      'manifest.toml'
    ])
  })

  test('nodes carry their full path', () => {
    expect(buildFileTree(['lib/armv7/libfoo.so'])).toEqual([
      {
        name: 'lib',
        path: 'lib',
        kind: 'folder',
        children: [
          {
            name: 'armv7',
            path: 'lib/armv7',
            kind: 'folder',
            children: [{ name: 'libfoo.so', path: 'lib/armv7/libfoo.so', kind: 'file' }]
          }
        ]
      }
    ])
  })

  test.each([
    ['a leading slash', '/etc/passwd'],
    ['a parent segment', 'assets/../manifest.toml'],
    ['an empty segment', 'assets//x'],
    ['a backslash', 'assets\\x'],
    ['a dot segment', './x']
  ])('%s stays one top-level file under its full text', (_name, entry) => {
    expect(buildFileTree([entry])).toEqual([{ name: entry, path: entry, kind: 'file' }])
  })

  test('an empty list and a file listed twice', () => {
    expect(buildFileTree([])).toEqual([])
    expect(outline(buildFileTree(['a/b', 'a/b']))).toEqual(['a/', '  b'])
  })
})
