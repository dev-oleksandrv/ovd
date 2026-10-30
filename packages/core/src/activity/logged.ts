import { OvdError } from '../errors/ovdError.js'
import type { ActivityAction, ActivityLog } from './activityLog.js'

export type Logged = <T>(
  action: ActivityAction,
  target: string,
  args: Record<string, string>,
  run: () => Promise<T>
) => Promise<T>

// Device actions are logged whether they succeed or fail (ADR 0011). An abort is not an
// outcome of the action, so it isn't logged.
export function createLogged(activity: ActivityLog): Logged {
  return async (action, target, args, run) => {
    try {
      const value = await run()
      await activity.append({ action, target, args, result: 'ok' })
      return value
    } catch (error) {
      if (error instanceof OvdError) {
        await activity.append({ action, target, args, result: 'error', errorCode: error.code })
      }
      throw error
    }
  }
}
