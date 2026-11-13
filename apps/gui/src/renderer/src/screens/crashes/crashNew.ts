import type { Crash } from '@ovd/core'
import { useSyncExternalStore } from 'react'

// Which crashes are NEW for the sidebar badge and the list: reports that appeared while OVD
// ran (main's watcher pushes them; a list read says it too, `crash.new`) and that the user
// hasn't opened yet. Module-level, as the launch outcomes are: it outlives the Crashes screen,
// which unmounts on navigation. Renderer memory only, never persisted.
let pending: ReadonlySet<string> = new Set()
const seen = new Set<string>()
const listeners = new Set<() => void>()

export function crashKey(device: string, id: number): string {
  return `${device}\n${id}`
}

function set(next: ReadonlySet<string>): void {
  if (next.size === pending.size && [...next].every((key) => pending.has(key))) return
  pending = next
  for (const listener of listeners) listener()
}

// A report main's watcher announced.
export function addNew(device: string, id: number): void {
  const key = crashKey(device, id)
  if (!seen.has(key)) set(new Set(pending).add(key))
}

// Opening a crash's detail clears its NEW for good.
export function markSeen(device: string, id: number): void {
  const key = crashKey(device, id)
  seen.add(key)
  if (pending.has(key)) {
    const next = new Set(pending)
    next.delete(key)
    set(next)
  }
}

// A list read: its NEW ones join, and the ones a launch already reported (`new` false) leave.
export function syncList(device: string, crashes: readonly Crash[]): void {
  const next = new Set(pending)
  for (const crash of crashes) {
    const key = crashKey(device, crash.id)
    if (crash.new && !seen.has(key)) next.add(key)
    else next.delete(key)
  }
  set(next)
}

export function newCrashIds(): ReadonlySet<string> {
  return pending
}

// How many NEW crashes the device has.
export function newCount(device: string | null, ids: ReadonlySet<string> = pending): number {
  if (device === null) return 0
  const prefix = `${device}\n`
  let count = 0
  for (const key of ids) if (key.startsWith(prefix)) count++
  return count
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useNewCrashIds(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, newCrashIds)
}

// The sidebar badge's number for the target.
export function useNewCount(device: string | null): number {
  return newCount(device, useNewCrashIds())
}

// For tests: the store is shared by every render in a test file.
export function resetCrashNew(): void {
  pending = new Set()
  seen.clear()
  for (const listener of listeners) listener()
}
