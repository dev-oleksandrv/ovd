import type { LaunchCrash } from '@ovd/core'
import { useSyncExternalStore } from 'react'

// What the desktop shows for an app after a launch or restart, until the next action on it or
// until the list shows it running.
export type LaunchOutcome =
  { state: 'verifying' } | { state: 'crashed'; crash: LaunchCrash } | { state: 'not-running' }

export type LaunchOutcomes = Readonly<Record<string, LaunchOutcome>>

// Module-level: it outlives `AppsScreen`, which unmounts on navigation (`shell/Shell.tsx`), so
// "Crashed on launch" survives screen switches for the session (spec AC 7). Renderer memory
// only, never persisted.
let outcomes: LaunchOutcomes = {}
const listeners = new Set<() => void>()

export function outcomeKey(device: string, packageId: string): string {
  return `${device}\n${packageId}`
}

export function setLaunchOutcome(key: string, outcome: LaunchOutcome | undefined): void {
  if (outcome === undefined && !(key in outcomes)) return
  const next = { ...outcomes }
  if (outcome === undefined) delete next[key]
  else next[key] = outcome
  outcomes = next
  for (const listener of listeners) listener()
}

export function launchOutcomes(): LaunchOutcomes {
  return outcomes
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useLaunchOutcomes(): LaunchOutcomes {
  return useSyncExternalStore(subscribe, launchOutcomes)
}

// For tests: the store is shared by every render in a test file.
export function resetLaunchOutcomes(): void {
  outcomes = {}
  for (const listener of listeners) listener()
}
