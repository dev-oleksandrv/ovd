import type { VvdStartResult } from '@ovd/core'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import type { IpcResult } from '../../../src/preload/api'
import { useVvdActions } from '../../../src/renderer/src/devices/useVvdActions'
import { FeedbackProvider } from '../../../src/renderer/src/feedback/FeedbackProvider'
import { vvd } from '../screens/devices/sample'
import { ready, stubOvd } from '../support/ovdStub'

const started: IpcResult<VvdStartResult> = {
  ok: true,
  data: {
    running: true,
    status: 'online',
    device: { ...vvd, status: 'online' },
    grpc: { status: 'on', port: 8554 }
  }
}

// A start that answers when the test releases it.
function heldStart() {
  let release = (): void => undefined
  const start = () =>
    new Promise<IpcResult<VvdStartResult>>((resolve) => {
      release = () => resolve(started)
    })
  return { start, release: () => release() }
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <FeedbackProvider>{children}</FeedbackProvider>
)

describe('useVvdActions', () => {
  test('Turn on while a Start runs does nothing: one start at a time', async () => {
    const held = heldStart()
    const { api } = stubOvd({ list: async () => ready([vvd]), vvd: { start: held.start } })
    const { result } = renderHook(() => useVvdActions(), { wrapper })
    let start: Promise<boolean> | undefined
    act(() => {
      start = result.current.start()
    })
    let turnOn: boolean | undefined
    await act(async () => {
      turnOn = await result.current.enableGrpc()
    })
    expect(turnOn).toBe(false)
    held.release()
    await act(async () => {
      expect(await start).toBe(true)
    })
    expect(api.vvd.start).toHaveBeenCalledTimes(1)
  })

  test('Start or Stop while Turn on runs does nothing', async () => {
    const held = heldStart()
    const { api } = stubOvd({ list: async () => ready([vvd]), vvd: { start: held.start } })
    const { result } = renderHook(() => useVvdActions(), { wrapper })
    let turnOn: Promise<boolean> | undefined
    act(() => {
      turnOn = result.current.enableGrpc()
    })
    await act(async () => {
      expect(await result.current.start()).toBe(false)
      expect(await result.current.stop()).toBe(false)
    })
    held.release()
    await act(async () => {
      expect(await turnOn).toBe(true)
    })
    expect(api.vvd.start).toHaveBeenCalledTimes(1)
    expect(api.vvd.stop).not.toHaveBeenCalled()
  })
})
