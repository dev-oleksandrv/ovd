import { describe, expect, test } from 'vitest'
import { OvdError, parseProjectDoctor } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

const recorded = (name: string) => fixture(`0.24/vega-project-doctor/${name}.txt`)

describe('parseProjectDoctor', () => {
  test('reads every check, its status and message from a run with one warning', () => {
    const result = parseProjectDoctor(recorded('one-warning'))
    expect(result.checks).toHaveLength(10)
    expect(result.checks[0]).toEqual({
      name: 'SDK manifest',
      status: 'ok',
      message: '1 OS versions, 2 RN versions'
    })
    expect(result.checks[2]).toEqual({
      name: 'os.min ≤ os.target',
      status: 'ok',
      message: '1.2 ≤ 1.2'
    })
    expect(result.checks[6]).toEqual({
      name: 'Scoped deps in profile',
      status: 'warn',
      message:
        '@amazon-devices/eslint-plugin-kepler not a managed OS-version package (typo, or a package the SDK does not track)'
    })
    expect(result.failed).toBe(0)
    expect(result.warnings).toBe(1)
  })

  test('keeps the fix hints, links included, and ignores the manifest validation preamble', () => {
    const result = parseProjectDoctor(recorded('one-warning'))
    expect(result.fixes).toEqual([
      'Remove unknown scoped packages or check OS version',
      'Docs: https://developer.amazon.com/docs/vega/latest/vega-get-started.html'
    ])
    expect(result.checks.map((c) => c.name)).not.toContain('manifest.toml')
  })

  test('counts failed checks and warnings', () => {
    const result = parseProjectDoctor(recorded('failed'))
    expect(result.failed).toBe(2)
    expect(result.warnings).toBe(2)
    expect(result.checks.find((c) => c.name === 'OS versions valid')).toEqual({
      name: 'OS versions valid',
      status: 'fail',
      message: 'min "9.9" not in [1.2]'
    })
  })

  test('reads a folder that is not a project as one failed check, with both fix lists', () => {
    const result = parseProjectDoctor(recorded('no-project'))
    expect(result.checks).toEqual([
      {
        name: 'Project config',
        status: 'fail',
        message: 'Missing OS Version and RN version.'
      }
    ])
    expect(result.fixes).toContain(
      'Run: vega project update-manifest --os-version <version> --os-min <version>'
    )
    expect(result.fixes).toContain(
      'Docs: https://developer.amazon.com/docs/vega/latest/vega-get-started.html'
    )
  })

  test.each([
    ['empty output', ''],
    ['unrelated output', 'Usage: vega project doctor [options]\n']
  ])('rejects %s', (_case, stdout) => {
    expect(() => parseProjectDoctor(stdout)).toThrow(OvdError)
  })
})
