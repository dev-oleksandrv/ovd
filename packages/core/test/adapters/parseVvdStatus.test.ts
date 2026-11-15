import { describe, expect, test } from 'vitest'
import { isVvdNoInstance, parseVvdStatus } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

describe('parseVvdStatus', () => {
  test.each([
    ['0.24/vega-virtual-device-status/running.json', { running: true }],
    ['0.24/vega-virtual-device-status/stopped.json', { running: false }],
    ['2.0/vega-virtual-device-status/running.json', { running: true }]
  ])('%s', (file, expected) => {
    expect(parseVvdStatus(fixture(file))).toEqual(expected)
  })

  test.each([
    '',
    'Virtual device ready.',
    '{"running":"yes"}',
    fixture('2.0/vega-virtual-device-status/no-instance.txt')
  ])('rejects %j', (out) => {
    expect(() => parseVvdStatus(out)).toThrow(
      expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' })
    )
  })
})

describe('isVvdNoInstance', () => {
  const noInstance = {
    stdout: fixture('2.0/vega-virtual-device-status/no-instance.txt'),
    stderr: fixture('2.0/vega-virtual-device-status/no-instance.stderr.txt'),
    exitCode: 1
  }

  test('SDK 2.0 before the first start: no instance yet', () => {
    expect(isVvdNoInstance(noInstance)).toBe(true)
  })

  test('the message on stderr alone is enough', () => {
    expect(isVvdNoInstance({ ...noInstance, stdout: '' })).toBe(true)
  })

  test.each([
    [
      'a running Virtual Device',
      { stdout: fixture('2.0/vega-virtual-device-status/running.json'), stderr: '', exitCode: 0 }
    ],
    ['an SDK without a Virtual Device', { stdout: '', stderr: '', exitCode: 1 }],
    ['another failure', { stdout: '', stderr: 'virtualdevice: not found', exitCode: 127 }],
    ['the message with exit 0', { ...noInstance, exitCode: 0 }]
  ])('not for %s', (_name, result) => {
    expect(isVvdNoInstance(result)).toBe(false)
  })
})
