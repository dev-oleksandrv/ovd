import type { PackageValidation, ValidationIssue } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import {
  issueLine,
  locationText,
  manifestErrors,
  manifestNotes,
  summaryText,
  tabCli,
  tabItems,
  treeRows,
  worstSeverity
} from '../../../../src/renderer/src/screens/packages/packageTabsView'
import { brokenValidation, validValidation } from './tabsSample'

const at = (line: number, severity: ValidationIssue['severity'] = 'error'): ValidationIssue => ({
  severity,
  message: 'm',
  file: 'manifest.toml',
  line,
  column: 1
})

describe('packageTabsView', () => {
  test('the Validate tab carries the error count once validated', () => {
    expect(tabItems(undefined).map((t) => [t.id, t.badge])).toEqual([
      ['overview', undefined],
      ['manifest', undefined],
      ['files', undefined],
      ['validate', undefined]
    ])
    expect(tabItems({ status: 'ready', data: brokenValidation }).at(-1)).toEqual({
      id: 'validate',
      label: 'Validate',
      badge: 3,
      badgeTone: 'error'
    })
    expect(tabItems({ status: 'ready', data: validValidation }).at(-1)?.badge).toBeUndefined()
    expect(tabItems({ status: 'loading' }).at(-1)?.badge).toBeUndefined()
  })

  test.each([
    ['overview', 'ovd pkg info ~/p.vpkg'],
    ['manifest', 'ovd pkg manifest ~/p.vpkg'],
    ['files', 'ovd pkg files ~/p.vpkg'],
    ['validate', 'ovd pkg validate ~/p.vpkg']
  ] as const)('%s echoes %s', (tab, cli) => {
    expect(tabCli(tab, '~/p.vpkg')).toBe(cli)
  })

  test.each([
    [{ severity: 'error', message: 'm' }, '—', undefined],
    [{ severity: 'error', message: 'm', file: 'manifest.toml' }, 'manifest.toml', undefined],
    [{ ...at(7), column: 16 }, 'manifest.toml:7:16', 7],
    [{ severity: 'error', message: 'm', file: 'manifest.toml', line: 4 }, 'manifest.toml:4', 4],
    [{ severity: 'error', message: 'm', file: 'other.json', line: 4 }, 'other.json:4', undefined]
  ] as [ValidationIssue, string, number | undefined][])('location %#', (issue, text, line) => {
    expect(locationText(issue)).toBe(text)
    expect(issueLine(issue)).toBe(line)
  })

  test.each([
    [validValidation, 'No problems found'],
    [{ ...validValidation, infos: 5 }, 'Valid · 5 notes'],
    [brokenValidation, '3 errors · 5 notes'],
    [{ ...brokenValidation, errors: 1, infos: 0, warnings: 0 }, '1 error']
  ] as [PackageValidation, string][])('summary %#', (v, text) => {
    expect(summaryText(v)).toBe(text)
  })

  test('notes by line, and those without a line', () => {
    const { byLine, unlocated } = manifestNotes(brokenValidation)
    expect([...byLine.keys()].sort((a, b) => a - b)).toEqual([3, 7, 27, 33])
    expect(byLine.get(27)).toHaveLength(4)
    expect(unlocated.map((i) => i.key)).toEqual(['os.version'])
    expect(manifestNotes(undefined).byLine.size).toBe(0)
  })

  test('the worst severity of a line', () => {
    expect(worstSeverity([at(1, 'info'), at(1, 'error')])).toBe('error')
    expect(worstSeverity([at(1, 'info'), at(1, 'warning')])).toBe('warning')
    expect(worstSeverity([])).toBeUndefined()
  })

  test('errors shown on manifest.toml: located there, or naming a key', () => {
    expect(manifestErrors(brokenValidation)).toBe(3)
    expect(manifestErrors(validValidation)).toBe(0)
    expect(
      manifestErrors({
        ...validValidation,
        issues: [{ severity: 'error', message: 'vpt validate failed' }]
      })
    ).toBe(0)
  })

  test('the tree flattened with depths', () => {
    expect(
      treeRows([
        {
          name: 'a',
          path: 'a',
          kind: 'folder',
          children: [{ name: 'b', path: 'a/b', kind: 'file' }]
        },
        { name: 'c', path: 'c', kind: 'file' }
      ]).map((r) => [r.node.path, r.depth])
    ).toEqual([
      ['a', 0],
      ['a/b', 1],
      ['c', 0]
    ])
  })
})
