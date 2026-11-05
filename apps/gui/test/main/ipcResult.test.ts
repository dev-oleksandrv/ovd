// @vitest-environment node
import { OvdError } from '@ovd/core'
import { describe, expect, test } from 'vitest'
import { toResult } from '../../src/main/ipcResult'

describe('toResult', () => {
  test('wraps the action result as ok', async () => {
    await expect(toResult(async () => ({ id: 'G070000000000001' }))).resolves.toEqual({
      ok: true,
      data: { id: 'G070000000000001' }
    })
  })

  test('maps an OvdError to its JSON code, message and hint', async () => {
    const error = new OvdError('TARGET_OFFLINE', 'Living room stick is offline', 'Reconnect it', {
      id: 'G070000000000001'
    })

    await expect(
      toResult(async () => {
        throw error
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TARGET_OFFLINE',
        message: 'Living room stick is offline',
        hint: 'Reconnect it'
      }
    })
  })

  test('rethrows anything that is not an OvdError', async () => {
    const bug = new Error('unexpected')

    await expect(
      toResult(async () => {
        throw bug
      })
    ).rejects.toBe(bug)
  })
})
