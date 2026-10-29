import { OvdError, toErrorJson, type ErrorJson } from '../errors/ovdError.js'
import type { DevicesSnapshot } from './types.js'

export type DevicesUpdate = ({ ok: true } & DevicesSnapshot) | { ok: false; error: ErrorJson }

export interface DevicesWatcher {
  start(): void
  stop(): void
  // Polls now (also while stopped) and resolves with the result; Rescan and actions use it.
  refresh(): Promise<DevicesUpdate>
}

const INTERVAL_MS = 2_000

// Polls the device list for the desktop (spec D9) and emits only when something changed.
// The next poll is scheduled after the previous one finished, so slow SDK calls never pile up.
export function createDevicesWatcher(opts: {
  list: () => Promise<DevicesSnapshot>
  onUpdate: (update: DevicesUpdate) => void
  intervalMs?: number
}): DevicesWatcher {
  const intervalMs = opts.intervalMs ?? INTERVAL_MS
  let running = false
  // Bumped by stop(), so a poll started before it can't emit or reschedule.
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<DevicesUpdate> | undefined
  let last: string | undefined

  function poll(): Promise<DevicesUpdate> {
    const current = opts.list().then(
      (snapshot): DevicesUpdate => ({ ok: true, ...snapshot }),
      (error: unknown): DevicesUpdate => ({ ok: false, error: toUpdateError(error) })
    )
    inFlight = current
    void current.then(() => {
      if (inFlight === current) inFlight = undefined
    })
    return current
  }

  function emit(update: DevicesUpdate): void {
    const json = JSON.stringify(update)
    if (json === last) return
    last = json
    opts.onUpdate(update)
  }

  async function tick(): Promise<void> {
    const mine = generation
    const update = await (inFlight ?? poll())
    if (!running || mine !== generation) return
    emit(update)
    timer = setTimeout(() => void tick(), intervalMs)
  }

  return {
    start() {
      if (running) return
      running = true
      void tick()
    },

    stop() {
      running = false
      generation++
      clearTimeout(timer)
    },

    async refresh() {
      if (inFlight) await inFlight
      const update = await poll()
      emit(update)
      return update
    }
  }
}

function toUpdateError(error: unknown): ErrorJson {
  if (error instanceof OvdError) return toErrorJson(error)
  return {
    code: 'COMMAND_FAILED',
    message: error instanceof Error ? error.message : String(error),
    hint: 'Restart OVD. If it keeps failing, run ovd devices in a terminal'
  }
}
