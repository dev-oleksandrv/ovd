import { onTestFinished } from 'vitest'
import type { World } from '../fake-sdk/world.ts'
import { openSandbox, type Sandbox } from './sandbox.ts'

export type { Sandbox } from './sandbox.ts'

// How long closing a sandbox may take: it stops what the test left running (a few seconds at
// most, sandbox.ts), longer than Vitest's default 10 s hook timeout would allow in the worst case.
const CLOSE_TIMEOUT_MS = 20_000

// One sandbox per Vitest test, closed when it ends: checked for unrecorded commands and for
// processes still running, which it stops.
export function createSandbox(world: Partial<World> = {}): Sandbox {
  const sandbox = openSandbox(world)
  onTestFinished(() => sandbox.close(), CLOSE_TIMEOUT_MS)
  return sandbox
}
