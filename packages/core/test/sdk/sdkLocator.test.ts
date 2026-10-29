import { describe, expect, test, vi } from 'vitest'
import { createSdkLocator, OvdError, type SdkInfo } from '../../src/index.js'

const info = (sdkVersion: string): SdkInfo => ({
  vegaPath: '/sdk/vega',
  cli: 'manager',
  sdkVersion,
  cliVersion: '1.4.5'
})

describe('createSdkLocator', () => {
  test('discovers once, also for concurrent callers', async () => {
    const discover = vi.fn(async () => info('0.24.12112'))
    const sdk = createSdkLocator(discover)
    await Promise.all([sdk.get(), sdk.get()])
    await sdk.get()
    expect(discover).toHaveBeenCalledTimes(1)
  })

  test('does not cache a failed discovery', async () => {
    const discover = vi
      .fn<() => Promise<SdkInfo>>()
      .mockRejectedValueOnce(new OvdError('SDK_NOT_FOUND', 'No Vega SDK found', 'Install it'))
      .mockResolvedValueOnce(info('0.24.12112'))
    const sdk = createSdkLocator(discover)
    await expect(sdk.get()).rejects.toMatchObject({ code: 'SDK_NOT_FOUND' })
    await expect(sdk.get()).resolves.toMatchObject({ sdkVersion: '0.24.12112' })
    expect(discover).toHaveBeenCalledTimes(2)
  })

  test('rediscover replaces the cached result', async () => {
    const discover = vi
      .fn<() => Promise<SdkInfo>>()
      .mockResolvedValueOnce(info('0.24.12112'))
      .mockResolvedValueOnce(info('0.25.1'))
    const sdk = createSdkLocator(discover)
    await sdk.get()
    await expect(sdk.rediscover()).resolves.toMatchObject({ sdkVersion: '0.25.1' })
    await expect(sdk.get()).resolves.toMatchObject({ sdkVersion: '0.25.1' })
    expect(discover).toHaveBeenCalledTimes(2)
  })
})
