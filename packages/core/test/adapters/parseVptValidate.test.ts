import { describe, expect, test } from 'vitest'
import { isOvdError, parseVptValidate, type ValidationIssue } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

// stdout, stderr and exit code as recorded (fixtures/0.24/README.md).
function recorded(name: string, exitCode: number) {
  const read = (file: string) => {
    try {
      return fixture(`0.24/vpt-validate/${file}`)
    } catch {
      return ''
    }
  }
  return { stdout: read(`${name}.txt`), stderr: read(`${name}.stderr.txt`), exitCode }
}

const located = (issues: ValidationIssue[]) =>
  issues.map((i) => [i.severity, i.line ?? null, i.column ?? null, i.key ?? null])

const PRIVILEGE_INFO = ['info', 27, 6, 'wants.module.id']

describe('parseVptValidate', () => {
  test('a valid package: exit 0, its info notes, nothing about vpt’s own staging', () => {
    const result = parseVptValidate(recorded('player-aarch64-release', 0))
    expect(result.kind).toBe('validated')
    if (result.kind !== 'validated') return
    expect(result.valid).toBe(true)
    expect(located(result.issues)).toEqual([
      ['info', 3, 1, 'package.icon'],
      PRIVILEGE_INFO,
      PRIVILEGE_INFO,
      PRIVILEGE_INFO,
      PRIVILEGE_INFO
    ])
    expect(result.issues[0]).toEqual({
      severity: 'info',
      key: 'package.icon',
      message: 'Icon is not defined in the manifest. System default will be used.',
      file: 'manifest.toml',
      line: 3,
      column: 1,
      help: 'Define icon to help users recognize your application'
    })
  })

  test('a broken package: located errors, the unlocated OS version error, no repeats', () => {
    const result = parseVptValidate(recorded('player-aarch64-broken', 1))
    if (result.kind !== 'validated') throw new Error('expected a validation')
    expect(result.valid).toBe(false)
    expect(located(result.issues)).toEqual([
      ['info', 3, 1, 'package.icon'],
      ['error', 7, 16, 'package.build-number'],
      ['error', 33, 15, 'components.interactive.launch-type'],
      PRIVILEGE_INFO,
      PRIVILEGE_INFO,
      PRIVILEGE_INFO,
      PRIVILEGE_INFO,
      // From the summary: no line. `Error 3: build_number …` repeats 7:16 and is dropped.
      ['error', null, null, 'os.version']
    ])
    expect(result.issues.at(-1)).toEqual({
      severity: 'error',
      key: 'os.version',
      message: 'contains value(s) not in the OS Version registry.',
      help: '- min: \'9.9\' is not minted\nValid OS Versions: "1.2"'
    })
    expect(result.issues[2]?.message).toBe(
      "'sometimes' launch type is not supported for 'interactive' component."
    )
  })

  test.each([
    ['manifest-syntax', 5, 17, 'invalid basic string'],
    ['manifest-missing-field', 3, 1, 'missing field `id`'],
    ['manifest-wrong-type', 7, 16, 'invalid type: string "one", expected i64']
  ])('%s: the TOML error at its line and column', (name, line, column, message) => {
    const result = parseVptValidate(recorded(name, 1))
    if (result.kind !== 'validated') throw new Error('expected a validation')
    expect(result.valid).toBe(false)
    expect(result.issues).toEqual([
      { severity: 'error', message, file: 'manifest.toml', line, column }
    ])
  })

  test.each([
    ['manifest-empty-title', 'package.title', 3, undefined],
    [
      'manifest-component-id',
      'components.interactive.id',
      24,
      'Component ID should follow the format: package_id.component_name'
    ]
  ])('%s: one located error', (name, key, line, help) => {
    const result = parseVptValidate(recorded(name, 1))
    if (result.kind !== 'validated') throw new Error('expected a validation')
    const errors = result.issues.filter((i) => i.severity === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ key, line, file: 'manifest.toml' })
    expect(errors[0]?.help).toBe(help)
  })

  test('an OS version the registry lacks: stdout says valid, the exit code and summary don’t', () => {
    const result = parseVptValidate(recorded('manifest-os-version', 1))
    if (result.kind !== 'validated') throw new Error('expected a validation')
    expect(result.valid).toBe(false)
    const errors = result.issues.filter((i) => i.severity === 'error')
    expect(errors.map((i) => [i.key, i.line])).toEqual([['os.version', undefined]])
  })

  test.each([
    ['missing', 'Provided path does not exist'],
    [
      'not-a-vpkg',
      "Provided path '/home/dev/Downloads/notes.vpkg' is not a directory, archive, or manifest file"
    ]
  ])('%s: vpt didn’t validate', (name, message) => {
    expect(parseVptValidate(recorded(name, 1))).toEqual({ kind: 'failed', message })
  })

  test('an unknown severity is a warning; other warning lines are kept', () => {
    const result = parseVptValidate({
      stdout: 'manifest.toml:2:1 notice: [package] something\ndone.\n',
      stderr: 'warning: icon file is large\n',
      exitCode: 0
    })
    if (result.kind !== 'validated') throw new Error('expected a validation')
    expect(result.issues).toEqual([
      {
        severity: 'warning',
        key: 'package',
        message: 'something',
        file: 'manifest.toml',
        line: 2,
        column: 1
      },
      { severity: 'warning', message: 'icon file is large' }
    ])
  })

  test('CRLF, ANSI colors and control characters are removed', () => {
    const result = parseVptValidate({
      stdout:
        'manifest.toml:3:1 \u001b[34minfo\u001b[0m: [package.icon] Icon\u0007 missing\r\ndone.\r\n',
      stderr: '',
      exitCode: 0
    })
    if (result.kind !== 'validated') throw new Error('expected a validation')
    expect(result.issues).toEqual([
      {
        severity: 'info',
        key: 'package.icon',
        message: 'Icon missing',
        file: 'manifest.toml',
        line: 3,
        column: 1
      }
    ])
  })

  test('exit 1 with only generic summary entries is still one error', () => {
    const result = parseVptValidate({
      stdout: '',
      stderr:
        'Error: Validation failed with the following errors:\nError 1: manifest validation failed!\n',
      exitCode: 1
    })
    expect(result).toEqual({
      kind: 'validated',
      valid: false,
      issues: [{ severity: 'error', message: 'manifest validation failed!' }]
    })
  })

  test.each([
    ['exit 0 with an error line', 'manifest.toml:1:1 error: broken\ndone.\n', 0],
    ['exit 0 with nothing vpt prints', 'something else\n', 0]
  ])('%s is unexpected output', (_name, stdout, exitCode) => {
    let caught: unknown
    try {
      parseVptValidate({ stdout, stderr: '', exitCode })
    } catch (error) {
      caught = error
    }
    expect(isOvdError(caught) && caught.code).toBe('UNEXPECTED_OUTPUT')
  })
})
