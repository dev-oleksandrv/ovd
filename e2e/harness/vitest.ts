import { onTestFinished } from 'vitest'
import type { World } from '../fake-sdk/world.ts'
import { openSandbox, type Sandbox } from './sandbox.ts'

export type { Sandbox } from './sandbox.ts'

// One sandbox per Vitest test, closed (and checked for unrecorded commands) when it ends.
export function createSandbox(world: Partial<World> = {}): Sandbox {
  const sandbox = openSandbox(world)
  onTestFinished(() => sandbox.close())
  return sandbox
}
