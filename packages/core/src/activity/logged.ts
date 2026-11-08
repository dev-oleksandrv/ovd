import { OvdError, type ErrorCode } from '../errors/ovdError.js'
import type { ActivityAction, ActivityLog } from './activityLog.js'

// A result that is returned but still an error outcome for the activity log, with extra args.
export type LoggedOutcome<T> = (
  value: T
) => { errorCode: ErrorCode; args?: Record<string, string> } | undefined

export type Logged = <T>(
  action: ActivityAction,
  // null when the device isn't known yet (Developer Mode on a stick VDA doesn't list).
  target: string | null,
  args: Record<string, string>,
  run: () => Promise<T>,
  // An unverified launch is a returned result, not a thrown error: the surfaces need its crash
  // data, and `IpcResult` drops an error's extra fields (apps/gui/src/preload/api.ts). It is
  // still logged as an error, as one entry.
  outcome?: LoggedOutcome<T>
) => Promise<T>

// Device actions are logged whether they succeed or fail (ADR 0011). An abort is not an
// outcome of the action, so it isn't logged.
export function createLogged(activity: ActivityLog): Logged {
  return async (action, target, args, run, outcome) => {
    const attempt = async () => {
      try {
        return await run()
      } catch (error) {
        if (error instanceof OvdError) {
          await activity.append({ action, target, args, result: 'error', errorCode: error.code })
        }
        throw error
      }
    }
    const value = await attempt()
    const failed = outcome?.(value)
    await activity.append(
      failed
        ? {
            action,
            target,
            args: { ...args, ...failed.args },
            result: 'error',
            errorCode: failed.errorCode
          }
        : { action, target, args, result: 'ok' }
    )
    return value
  }
}
