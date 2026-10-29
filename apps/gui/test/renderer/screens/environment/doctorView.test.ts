import type { CheckStatus } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import {
  firstRunCount,
  firstRunPassed,
  gateOpen,
  rowView,
  summary
} from '../../../../src/renderer/src/screens/environment/doctorView'
import { doctorReport } from '../../support/ovdStub'

describe('rowView', () => {
  test.each([
    ['ok', 'check_circle', 'ok'],
    ['info', 'info', 'info'],
    ['warn', 'error', 'warning'],
    ['fail', 'cancel', 'error'],
    ['skipped', 'radio_button_unchecked', 'muted']
  ] as const)('%s', (status: CheckStatus, icon, tone) => {
    expect(rowView(status)).toEqual({ icon, tone })
  })
})

describe('summary', () => {
  test.each([
    [{}, 'All checks passed'],
    [
      { sdk: { status: 'fail' as const }, devices: { status: 'warn' as const } },
      '1 failing · 1 warning'
    ],
    [
      { devices: { status: 'warn' as const }, devmode: { status: 'warn' as const } },
      '0 failing · 2 warnings'
    ]
  ])('%j', (overrides, text) => {
    expect(summary(doctorReport(overrides).checks)).toBe(text)
  })
})

describe('first run', () => {
  test('counts the SDK, VDA and Devices checks that passed', () => {
    expect(firstRunCount(doctorReport().checks)).toBe('3 of 3 ready')
    expect(
      firstRunCount(
        doctorReport({ vda: { status: 'fail' }, devices: { status: 'skipped' } }).checks
      )
    ).toBe('1 of 3 ready')
  })

  test('devices pass only with a device online', () => {
    expect(firstRunPassed(doctorReport({ devices: { status: 'warn' } }).checks)).toBe(false)
    expect(firstRunPassed(doctorReport().checks)).toBe(true)
  })

  test('the gate opens once the SDK and VDA pass, devices or not', () => {
    expect(gateOpen(doctorReport({ sdk: { status: 'fail' } }).checks)).toBe(false)
    expect(gateOpen(doctorReport({ vda: { status: 'fail' } }).checks)).toBe(false)
    expect(gateOpen(doctorReport({ devices: { status: 'warn' } }).checks)).toBe(true)
    expect(gateOpen(doctorReport({ sdk: { status: 'warn' } }).checks)).toBe(true)
  })
})
