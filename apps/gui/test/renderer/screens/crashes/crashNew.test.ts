import { afterEach, describe, expect, test } from 'vitest'
import {
  addNew,
  markSeen,
  newCount,
  newCrashIds,
  resetCrashNew,
  syncList
} from '../../../../src/renderer/src/screens/crashes/crashNew'
import { jsCrash, nativeCrash } from './sample'

afterEach(resetCrashNew)

describe('the NEW store', () => {
  test('a pushed crash counts for its device only', () => {
    addNew('VirtualDevice', 1)
    addNew('VirtualDevice', 2)
    addNew('G070000000000001', 3)
    expect(newCount('VirtualDevice')).toBe(2)
    expect(newCount('G070000000000001')).toBe(1)
    expect(newCount(null)).toBe(0)
  })

  test('opening a crash clears its NEW for good', () => {
    addNew('d', 1)
    markSeen('d', 1)
    expect(newCount('d')).toBe(0)
    addNew('d', 1)
    syncList('d', [{ ...jsCrash, id: 1, new: true }])
    expect(newCount('d')).toBe(0)
  })

  test('a list read adds the NEW ones and drops those a launch already reported', () => {
    addNew('d', nativeCrash.id)
    syncList('d', [jsCrash, nativeCrash])
    expect([...newCrashIds()]).toEqual([`d\n${jsCrash.id}`])
  })

  test('the same set is not a change', () => {
    addNew('d', 1)
    const before = newCrashIds()
    addNew('d', 1)
    expect(newCrashIds()).toBe(before)
  })
})
