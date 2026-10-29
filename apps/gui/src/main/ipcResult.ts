import { isOvdError, toErrorJson } from '@ovd/core'
import type { IpcResult } from '../preload/api'

export async function toResult<T>(action: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await action() }
  } catch (error) {
    if (isOvdError(error)) return { ok: false, error: toErrorJson(error) }
    throw error
  }
}
