// The detached SDK process groups that are running right now (`stream` and `stopWhen` commands).
// Each one runs with `detached: true`, so its leader's pid is also its group id.
//
// Process-wide, not per `Ovd`: an exit hook must reach every group without creating a core
// (the CLI creates its `Ovd` lazily), and a process has one set of children. `stopAll` is
// synchronous because it runs in `process.on('exit')` and Electron's `will-quit`, where
// nothing asynchronous gets to run. Every registration is its own entry, so the set stays
// correct when many streams start and stop in one process (Stage 3.2).
export interface ProcessGroups {
  // Adds the group; the returned function removes this registration, and only once.
  register(pid: number): () => void
  // SIGTERM to every registered group. Never throws, waits or SIGKILLs, and removes nothing:
  // each registration goes when its own run ends.
  stopAll(): void
  // A copy of the registered pids, for tests.
  pids(): readonly number[]
}

type Kill = (pid: number, signal: NodeJS.Signals) => void

export function createProcessGroups(
  kill: Kill = (pid, signal) => {
    process.kill(pid, signal)
  }
): ProcessGroups {
  const entries = new Set<{ pid: number }>()
  return {
    register(pid) {
      const entry = { pid }
      entries.add(entry)
      return () => {
        entries.delete(entry)
      }
    },
    stopAll() {
      for (const { pid } of entries) {
        try {
          kill(-pid, 'SIGTERM')
        } catch {
          // ESRCH (already gone), EPERM or anything else: the other groups still get theirs.
        }
      }
    },
    pids: () => [...entries].map((e) => e.pid)
  }
}

// The one registry of this process.
export const processGroups = createProcessGroups()
