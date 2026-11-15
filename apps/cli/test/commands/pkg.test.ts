import type {
  FolderProject,
  PackageBuild,
  PackageFiles,
  PackageInfo,
  PackageManifest,
  PackageValidation
} from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import { cli } from '../support/runCli.js'
import { fail, stubPackages } from '../support/sample.js'

const info: PackageInfo = {
  path: '/home/dev/dev/player/build/armv7-release/player_armv7.vpkg',
  displayPath: '~/dev/player/build/armv7-release/player_armv7.vpkg',
  file: 'player_armv7.vpkg',
  id: 'com.example.player',
  title: 'Sample Player',
  version: '1.4.2',
  buildNumber: 142,
  size: 1459188,
  unpackedSize: 2817790,
  architecture: 'armv7',
  buildType: 'release',
  osVersions: ['1.2'],
  contractPackageVersion: '1.0.323.0',
  sha384: '0ee2046b',
  modifiedAt: '2026-11-01T14:02:00.000Z',
  vptInfo: { id: 'com.example.player' }
}

const folder: FolderProject = {
  kind: 'folder',
  path: '/home/dev/dev/player',
  displayPath: '~/dev/player',
  name: 'player'
}

const build: PackageBuild = {
  path: info.path,
  displayPath: info.displayPath,
  file: 'player_armv7.vpkg',
  folder: 'build/armv7-release/',
  size: 2817790,
  modifiedAt: '2026-11-01T14:02:00.000Z',
  folderArch: 'armv7',
  folderBuildType: 'release'
}

describe('ovd pkg info', () => {
  test('--json prints the package', async () => {
    const read = vi.fn(async () => info)
    const { stdout, exitCode } = await cli(['pkg', 'info', 'player_armv7.vpkg', '--json'], {
      ovd: stubPackages({ info: read })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, package: info })
    expect(exitCode).toBe(0)
    expect(read).toHaveBeenCalledWith('player_armv7.vpkg')
  })

  test('without a file, reads the open .vpkg', async () => {
    const read = vi.fn(async () => info)
    await cli(['pkg', 'info', '--json'], { ovd: stubPackages({ info: read }) })
    expect(read).toHaveBeenCalledWith(undefined)
  })

  test('human output lists the package’s rows', async () => {
    const { stdout } = await cli(['pkg', 'info', 'x.vpkg'], {
      ovd: stubPackages({ info: async () => ({ ...info, architecture: 'any' }) })
    })
    expect(stdout).toContain('Version       1.4.2 (142)\n')
    expect(stdout).toContain('Architecture  any (no native code)\n')
    expect(stdout).toContain('Build type    Release\n')
    expect(stdout).toContain('Size          1.5 MB (2.8 MB unpacked)\n')
  })

  test.each(['NO_PACKAGE', 'NOT_A_VPKG', 'PATH_NOT_FOUND'] as const)(
    '%s is a usage error (exit 2)',
    async (code) => {
      const { stdout, exitCode } = await cli(['pkg', 'info', '--json'], {
        ovd: stubPackages({ info: fail(code) })
      })
      expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code } })
      expect(exitCode).toBe(2)
    }
  )

  test('an SDK failure exits 1', async () => {
    const { exitCode } = await cli(['pkg', 'info', 'x.vpkg', '--json'], {
      ovd: stubPackages({ info: fail('COMMAND_FAILED') })
    })
    expect(exitCode).toBe(1)
  })
})

describe('ovd pkg list', () => {
  test('--json prints the builds', async () => {
    const { stdout, exitCode } = await cli(['pkg', 'list', '--json'], {
      ovd: stubPackages({ builds: async () => [build] }, { current: async () => folder })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, builds: [build] })
    expect(exitCode).toBe(0)
  })

  test('human output shows each build with its folder hints', async () => {
    const { stdout } = await cli(['pkg', 'list'], {
      ovd: stubPackages({ builds: async () => [build] }, { current: async () => folder })
    })
    expect(stdout).toMatch(
      /^build\/armv7-release\/player_armv7\.vpkg {2}armv7 {2}Release {2}2\.8 MB {2}2026-11-0\d \d\d:\d\d\n$/
    )
  })

  test('nothing open', async () => {
    const { stdout, stderr, exitCode } = await cli(['pkg', 'list'], {
      ovd: stubPackages({ builds: async () => [] }, { current: async () => null })
    })
    expect(stdout).toBe('No project open.\n')
    expect(stderr).toContain('ovd open')
    expect(exitCode).toBe(0)
  })

  test('a project without builds', async () => {
    const { stdout } = await cli(['pkg', 'list'], {
      ovd: stubPackages({ builds: async () => [] }, { current: async () => folder })
    })
    expect(stdout).toBe('No builds in build/.\n')
  })
})

// Stage 5.3: what core returns for the recorded broken sample, trimmed.
const ref = {
  path: '/home/dev/Downloads/player_aarch64.vpkg',
  displayPath: '~/Downloads/player_aarch64.vpkg',
  file: 'player_aarch64.vpkg'
}
const broken: PackageValidation = {
  ...ref,
  valid: false,
  errors: 2,
  warnings: 0,
  infos: 1,
  issues: [
    {
      severity: 'info',
      key: 'package.icon',
      message: 'Icon is not defined in the manifest.',
      file: 'manifest.toml',
      line: 1,
      column: 1,
      help: 'Define icon'
    },
    {
      severity: 'error',
      key: 'package.build-number',
      message: 'build-number must be greater than 0, found: 0',
      file: 'manifest.toml',
      line: 2,
      column: 16,
      help: 'Provide a positive integer for build-number'
    },
    {
      severity: 'error',
      key: 'os.version',
      message: 'contains value(s) not in the OS Version registry.',
      help: '- min: \'9.9\' is not minted\nValid OS Versions: "1.2"'
    }
  ]
}
const valid: PackageValidation = { ...broken, valid: true, errors: 0, infos: 0, issues: [] }

describe('ovd pkg validate', () => {
  test('--json: an invalid package is PACKAGE_INVALID (exit 1) with the validation', async () => {
    const validate = vi.fn(async () => broken)
    const { stdout, exitCode } = await cli(['pkg', 'validate', 'p.vpkg', '--json'], {
      ovd: stubPackages({ validate })
    })
    expect(JSON.parse(stdout)).toEqual({
      ok: false,
      error: {
        code: 'PACKAGE_INVALID',
        message: 'player_aarch64.vpkg has 2 errors',
        hint: 'Fix the manifest, build again, and run ovd pkg validate'
      },
      validation: broken
    })
    expect(exitCode).toBe(1)
    expect(validate).toHaveBeenCalledWith('p.vpkg')
  })

  test('--json: a valid package exits 0', async () => {
    const { stdout, exitCode } = await cli(['pkg', 'validate', '--json'], {
      ovd: stubPackages({ validate: async () => valid })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, validation: valid })
    expect(exitCode).toBe(0)
  })

  test('human: the table on stdout, the error on stderr', async () => {
    const { stdout, stderr, exitCode } = await cli(['pkg', 'validate', 'p.vpkg'], {
      ovd: stubPackages({ validate: async () => broken })
    })
    expect(stdout).toContain('player_aarch64.vpkg is invalid: 2 errors, 1 note\n')
    expect(stdout).toContain(
      'error  manifest.toml:2:16  [package.build-number] build-number must be greater than 0, found: 0\n'
    )
    expect(stdout).toContain('error  —                   [os.version] contains value(s)')
    expect(stdout).toContain("help: - min: '9.9' is not minted\n")
    expect(stderr).toContain('Error: player_aarch64.vpkg has 2 errors\n')
    expect(exitCode).toBe(1)
  })

  test('human: control characters in a message are shown as escapes', async () => {
    const issue = { severity: 'info' as const, message: 'a\u001b[2Jb' }
    const { stdout } = await cli(['pkg', 'validate', 'p.vpkg'], {
      ovd: stubPackages({ validate: async () => ({ ...valid, infos: 1, issues: [issue] }) })
    })
    expect(stdout).toContain('a\\x1b[2Jb')
  })

  test('human: a control character in the file name is escaped on stdout and stderr', async () => {
    const named = { ...broken, file: 'p\u001b[2J.vpkg' }
    const { stdout, stderr } = await cli(['pkg', 'validate', 'p.vpkg'], {
      ovd: stubPackages({ validate: async () => named })
    })
    expect(stdout).toContain('p\\x1b[2J.vpkg is invalid')
    expect(stderr).toBe(
      'Error: p\\x1b[2J.vpkg has 2 errors\nFix the manifest, build again, and run ovd pkg validate\n'
    )
    expect(stdout + stderr).not.toContain('\u001b')
  })

  test.each(['NOT_A_VPKG', 'PATH_NOT_FOUND', 'NO_PACKAGE'] as const)('%s exits 2', async (code) => {
    const { stdout, exitCode } = await cli(['pkg', 'validate', '--json'], {
      ovd: stubPackages({ validate: fail(code) })
    })
    expect(JSON.parse(stdout)).toMatchObject({ ok: false, error: { code } })
    expect(exitCode).toBe(2)
  })
})

describe('ovd pkg manifest', () => {
  const manifest: PackageManifest = {
    ...ref,
    entry: 'manifest.toml',
    lines: ['[package]', 'build-number = 0'],
    validation: broken
  }

  test('--json prints the manifest with its validation, exit 0 even when invalid', async () => {
    const read = vi.fn(async () => manifest)
    const { stdout, exitCode } = await cli(['pkg', 'manifest', 'p.vpkg', '--json'], {
      ovd: stubPackages({ manifest: read })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, manifest })
    expect(exitCode).toBe(0)
    expect(read).toHaveBeenCalledWith('p.vpkg')
  })

  test('human: numbered lines, notes under their line, unlocated notes first', async () => {
    const { stdout } = await cli(['pkg', 'manifest', 'p.vpkg'], {
      ovd: stubPackages({ manifest: async () => manifest })
    })
    expect(stdout).toBe(
      [
        'error: [os.version] contains value(s) not in the OS Version registry.',
        "  - min: '9.9' is not minted",
        '  Valid OS Versions: "1.2"',
        '',
        '1 | [package]',
        '  | ^ info: [package.icon] Icon is not defined in the manifest.',
        '  |   Define icon',
        '2 | build-number = 0',
        '  |                ^ error: [package.build-number] build-number must be greater than 0, found: 0',
        '  |   Provide a positive integer for build-number',
        'player_aarch64.vpkg is invalid: 2 errors, 1 note',
        ''
      ].join('\n')
    )
  })
})

describe('ovd pkg files', () => {
  const files: PackageFiles = {
    ...ref,
    entries: ['assets/raw/a.json', 'manifest.toml'],
    tree: [
      {
        name: 'assets',
        path: 'assets',
        kind: 'folder',
        children: [
          {
            name: 'raw',
            path: 'assets/raw',
            kind: 'folder',
            children: [{ name: 'a.json', path: 'assets/raw/a.json', kind: 'file' }]
          }
        ]
      },
      { name: 'manifest.toml', path: 'manifest.toml', kind: 'file' }
    ]
  }

  test('--json prints the list and the tree', async () => {
    const { stdout, exitCode } = await cli(['pkg', 'files', '--json'], {
      ovd: stubPackages({ files: async () => files })
    })
    expect(JSON.parse(stdout)).toEqual({ ok: true, files })
    expect(exitCode).toBe(0)
  })

  test('human: the tree and the count', async () => {
    const { stdout } = await cli(['pkg', 'files', 'p.vpkg'], {
      ovd: stubPackages({ files: async () => files })
    })
    expect(stdout).toBe('assets/\n  raw/\n    a.json\nmanifest.toml\n2 files\n')
  })
})
