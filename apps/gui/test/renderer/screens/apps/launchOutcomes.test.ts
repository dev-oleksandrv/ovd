import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import {
  launchOutcomes,
  outcomeKey,
  resetLaunchOutcomes,
  setLaunchOutcome,
  useLaunchOutcomes
} from '../../../../src/renderer/src/screens/apps/launchOutcomes'

const key = outcomeKey('VirtualDevice', 'com.example.player')
const crash = { pid: 3200, time: '2026-11-08T01:51:44.657Z', stack: [], logs: [] }

afterEach(resetLaunchOutcomes)

describe('launchOutcomes', () => {
  test('keys by device and package', () => {
    expect(outcomeKey('VirtualDevice', 'com.example.player')).not.toBe(
      outcomeKey('G070000000000001', 'com.example.player')
    )
  })

  test('set, replace and clear an outcome', () => {
    setLaunchOutcome(key, { state: 'verifying' })
    expect(launchOutcomes()[key]).toEqual({ state: 'verifying' })
    setLaunchOutcome(key, { state: 'crashed', crash })
    expect(launchOutcomes()[key]).toEqual({ state: 'crashed', crash })
    setLaunchOutcome(key, undefined)
    expect(key in launchOutcomes()).toBe(false)
  })

  test('clearing what isn’t there keeps the same store', () => {
    const before = launchOutcomes()
    setLaunchOutcome(key, undefined)
    expect(launchOutcomes()).toBe(before)
  })

  test('the hook follows the store, and a new hook sees what an earlier one left', () => {
    const first = renderHook(() => useLaunchOutcomes())
    act(() => setLaunchOutcome(key, { state: 'crashed', crash }))
    expect(first.result.current[key]).toEqual({ state: 'crashed', crash })
    first.unmount()

    const second = renderHook(() => useLaunchOutcomes())
    expect(second.result.current[key]).toEqual({ state: 'crashed', crash })
    act(() => resetLaunchOutcomes())
    expect(second.result.current).toEqual({})
  })
})
