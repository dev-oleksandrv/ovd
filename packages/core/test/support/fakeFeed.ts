import type { ActivityEntry, ActivityFeed } from '../../src/index.js'

export interface FakeFeed extends ActivityFeed {
  // Delivers an entry to the subscribers at once, filling `time`, `surface: 'cli'`, `args: {}`
  // and `result: 'ok'` when not given.
  emit(entry: Partial<ActivityEntry> & Pick<ActivityEntry, 'action' | 'target'>): void
  subscribers(): number
}

// An activity feed the test drives: no file, no polling.
export function createFakeFeed(now: () => Date = () => new Date()): FakeFeed {
  const listeners = new Set<(entry: ActivityEntry) => void>()
  return {
    subscribe(listener) {
      // A wrapper per subscription, so one listener subscribed twice counts twice.
      const wrapped = (entry: ActivityEntry) => listener(entry)
      listeners.add(wrapped)
      return () => listeners.delete(wrapped)
    },
    emit(entry) {
      const full: ActivityEntry = {
        time: now().toISOString(),
        surface: 'cli',
        args: {},
        result: 'ok',
        ...entry
      }
      for (const listener of [...listeners]) listener(full)
    },
    subscribers: () => listeners.size
  }
}
