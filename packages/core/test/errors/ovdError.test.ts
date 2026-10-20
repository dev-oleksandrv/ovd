import { describe, expect, test } from 'vitest'
import { isOvdError, OvdError, toErrorJson } from '../../src/index.js'

describe('OvdError', () => {
  test('carries code, message, hint and details', () => {
    const e = new OvdError('SDK_NOT_FOUND', 'No Vega SDK found', 'Install the Vega SDK', {
      tried: ['vega']
    })
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('OvdError')
    expect([e.code, e.message, e.hint, e.details]).toEqual([
      'SDK_NOT_FOUND',
      'No Vega SDK found',
      'Install the Vega SDK',
      { tried: ['vega'] }
    ])
  })

  test('isOvdError tells OVD errors from other errors', () => {
    expect(isOvdError(new OvdError('COMMAND_FAILED', 'm', 'h'))).toBe(true)
    expect(isOvdError(new Error('x'))).toBe(false)
    expect(isOvdError('SDK_NOT_FOUND')).toBe(false)
  })

  test('toErrorJson returns the ADR 0006 error object', () => {
    const e = new OvdError('SDK_NOT_FOUND', 'No Vega SDK found', 'Install the Vega SDK', { a: 1 })
    expect(toErrorJson(e)).toEqual({
      code: 'SDK_NOT_FOUND',
      message: 'No Vega SDK found',
      hint: 'Install the Vega SDK'
    })
  })
})
