// A crash report of an app the developer installed (Stage 5.1). Its `id` is the report's vault
// index on that device: a non-negative integer, valid per device (`loggingctl vault --ls`).
// Everything here is either OVD-validated (id, pid, epoch, kind, signal, package) or device text
// with its control characters removed and its length bounded (version, build, summary).
export type CrashKind = 'js' | 'native'

export interface Crash {
  id: number
  // From the target's installed packages, never from the report's file name.
  package: string
  kind: CrashKind
  // The signal number from the file name, and its name from OVD's own table when it knows it.
  signal: number
  signalName?: string
  pid: number
  // ISO time of the crash, from the file name's epoch.
  time: string
  // `AppVersion` and `AppBuildNumber` of the report's header.
  version?: string
  build?: string
  // The first `Error:` line of the JS stack, else `CrashReason`.
  summary?: string
  // Appeared after this OVD process first read the device's vault, and not yet reported by a
  // launch.
  new: boolean
}

// `ovd crashes --json`: `{ ok: true, ...CrashesList }`.
export interface CrashesList {
  device: string
  crashes: Crash[]
}

// A crash with the device text the agent prompt and the detail view need. All of it is
// untrusted: it was written by the app.
export interface CrashDetail {
  crash: Crash
  reason?: string
  stack: string[]
}

export interface CrashWatchOptions {
  // `--device`; the selected target by default.
  device?: string
  intervalMs?: number
  // One call per new report, oldest first, after the `crash.detected` activity entry.
  onNew(crash: Crash, device: { id: string; name: string }): void
  // The target left (offline, stopped, unplugged) or came back. Polling goes on silently.
  onAway?(device: { id: string; name: string } | undefined): void
  onBack?(device: { id: string; name: string }): void
  // A poll failed (no target, an unreadable listing). Repeats of the same error are dropped.
  onError?(error: Error): void
}

// `ovd.crashes`: the crash reports of the developer's apps on the target (Stage 5.1).
export interface Crashes {
  // In scope only, newest first. A listing that can't be read is an OvdError, never `[]`.
  list(device?: string): Promise<CrashesList>
  // One in-scope report with its stack; INVALID_CRASH_ID or CRASH_NOT_FOUND. For the detail
  // view, the prompt and the pull.
  detail(
    id: string | number,
    device?: string
  ): Promise<CrashDetail & { device: { id: string; name: string } }>
  watch(opts: CrashWatchOptions): CrashWatch
}

export interface CrashWatch {
  stop(): void
}
