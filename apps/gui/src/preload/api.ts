import type {
  AppDetails,
  AppList,
  CapturesList,
  ArchCheck,
  Crash,
  CrashDetail,
  CrashPullResult,
  CrashesList,
  Device,
  DevicesUpdate,
  DoctorReport,
  EnableResult,
  ErrorJson,
  ForgetResult,
  InputBackend,
  InputTarget,
  InstallResult,
  InstallTarget,
  LaunchResult,
  LogCounts,
  LogEntry,
  LogExportFormat,
  LogFilterInput,
  RebootResult,
  LoginPrompt,
  PackageBuild,
  PackageInfo,
  PressResult,
  ProjectMode,
  ReinstallResult,
  RemoteKey,
  RestartResult,
  RunOutcome,
  RunStep,
  ScreenshotResult,
  TerminateResult,
  TextResult,
  UninstallResult,
  VvdStartResult,
  VvdState
} from '@ovd/core'

// A crash the renderer names: the device it shows and the report's vault index. Never a path:
// main resolves files from its own records.
export interface CrashRef {
  device: string
  id: number
}

export type CrashDetailResult = CrashDetail & { device: { id: string; name: string } }

// What Copy path and Copy prompt did: the host path of the report, and whether this call
// downloaded it (it wasn't there yet).
export interface CrashCopied {
  path: string
  downloaded: boolean
}

// A report that appeared on the target while the window was open.
export interface CrashNewEvent {
  device: { id: string; name: string }
  crash: Crash
}

export interface AppInfo {
  version: string
}

export interface SdkSummary {
  sdkVersion: string
}

// The filters the Logs screen sets; `since`/`until` are CLI-only.
export type LogsFilter = Pick<LogFilterInput, 'app' | 'system' | 'level' | 'search' | 'regex'>

// The log session main runs for the target (one at a time). `restartAfterInstall` is the
// footer toggle, kept for the app's run; `reconnecting` while the device is away.
export type LogsState =
  | { status: 'idle' }
  | { status: 'starting'; device: string; name: string; restartAfterInstall: boolean }
  | {
      status: 'running'
      device: string
      name: string
      startedAt: string
      restartAfterInstall: boolean
    }
  | {
      status: 'reconnecting'
      device: string
      name: string
      startedAt: string
      restartAfterInstall: boolean
    }
  | {
      status: 'ended'
      device: string
      name: string
      startedAt: string | null
      error: ErrorJson
      restartAfterInstall: boolean
    }

// What main pushes, tagged with the session number so a stale update is ignored. `reset`
// replaces the renderer's list; `append` adds to it and may carry no entries, only fresh counts
// and apps. At most one `append` goes out per ~100 ms.
export type LogsUpdate =
  | { kind: 'state'; session: number; state: LogsState }
  | {
      kind: 'reset' | 'append'
      session: number
      entries: LogEntry[]
      counts: LogCounts
      apps: string[]
    }

// What Export asks main for: the shown lines (up to `throughSeq` while paused) in `format`.
export interface LogsExportRequest {
  format: LogExportFormat
  throughSeq?: number
}

// What Export did. `empty`: no session or no shown lines, so no save dialog. `saved` carries
// what the CLI echo needs: the time of the last line (`--until`) and whether the file existed
// (the save dialog confirmed the replace, `--force`).
export type LogsExportResult =
  | { status: 'empty' }
  | { status: 'canceled' }
  | {
      status: 'saved'
      path: string
      format: LogExportFormat
      lines: number
      until: string
      replaced: boolean
    }

// How a run's log step went: a session started, the running one restarted after the install
// (or `timeout`: it didn't within 15 s, and the run went on), or `skipped`: the running one has
// restart after install off, the user's choice.
export type FollowOutcome = 'started' | 'restarted' | 'skipped' | 'timeout'

// What main pushes while a run goes: each step as it starts, and how its log step went.
export type RunProgress = { kind: 'step'; step: RunStep } | { kind: 'logs'; outcome: FollowOutcome }

// Watch (Stage 3.5): main watches the open project's `build/` folder. `folder` is its display
// path. Main is the source of truth: it pushes every change of it as a `state` event.
export type WatchState = { watching: false } | { watching: true; folder: string }

// A settled batch of the watched build folder, as core's `BuildChange` with its error as data.
// `build`: the changed build main redeploys on `target`; absent when none fits it or `error`.
export interface WatchChange {
  folder: string
  changed: PackageBuild[]
  build?: PackageBuild
  target?: InstallTarget
  error?: ErrorJson
}

// What main pushes while watching: its state, each batch (before its redeploy), the redeploy's
// result, and `stopped` when the watch ended by itself (another project was opened).
export type WatchEvent =
  | ({ kind: 'state' } & WatchState)
  | { kind: 'changed'; change: WatchChange }
  | { kind: 'redeployed'; device: string; result: IpcResult<RunOutcome> }
  | { kind: 'stopped' }

// One key press or text sent from the Remote screen, as the input session panel lists it.
// `label` is the key (`down`) or the text in quotes; `cli` is its `ovd input …` equivalent.
// Kept in main's memory only: the activity log has a text's length, never the text.
export interface InputSent {
  time: string
  kind: 'press' | 'text'
  label: string
  cli: string
  ok: boolean
  error?: ErrorJson
}

// The input session main keeps for the target (one at a time, ADR 0010). `opening` while a
// stick's `inputd-cli` console starts; `error` when it couldn't open (Retry opens it again).
// `sent` is the last 50, newest first.
export interface InputState {
  status: 'idle' | 'opening' | 'ready' | 'error'
  target: InputTarget | null
  backend: InputBackend | null
  error?: ErrorJson
  sent: InputSent[]
}

// What a press or a text did: the entry it added to `sent`, with the result when it worked.
export type InputOutcome =
  { ok: true; sent: InputSent; result: PressResult | TextResult } | { ok: false; sent: InputSent }

// A screenshot the desktop took, and whether it reached the clipboard.
export type ScreenshotTaken = ScreenshotResult & { copied: boolean }

// The live view main keeps for the target (one at a time, the Virtual Device only). `no-signal`
// once the device went away while it streamed; `error` when it couldn't stream.
export type ScreenStatus = 'idle' | 'connecting' | 'live' | 'no-signal' | 'error'

export interface ScreenState {
  status: ScreenStatus
  target: { id: string; name: string } | null
  error?: ErrorJson
}

// One frame main pushes: raw RGBA8888 pixels (a binary clone, never base64). `seq` is main's
// own counter; main sends the next frame only once the renderer acked this one.
export interface ScreenFramePush {
  seq: number
  width: number
  height: number
  timestampUs: number
  pixels: Uint8Array
}

// A stick's Refresh: the screenshot it saved and its PNG to show.
export interface ScreenRefreshed {
  shot: ScreenshotResult
  png: Uint8Array
}

// Core errors cross IPC as data: Electron drops custom error fields when a handler throws.
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: ErrorJson }

// The only surface the renderer sees (ADR 0004). Every method maps to one IPC channel in main.
export interface OvdApi {
  // Known in preload, so the palette shortcut and the title bar never wait for IPC.
  platform: 'darwin' | 'linux'
  appInfo(): Promise<AppInfo>
  sdk: {
    // The SDK this core runs; SDK_NOT_FOUND until one is installed.
    info(): Promise<IpcResult<SdkSummary>>
  }
  doctor: {
    // Runs every check again (Re-check and "Run ovd doctor"); never changes anything.
    run(): Promise<IpcResult<DoctorReport>>
  }
  devices: {
    // Polls now and resolves with the result; also what Rescan does.
    list(): Promise<DevicesUpdate>
    rename(id: string, name: string): Promise<IpcResult<Device>>
    setTarget(id: string): Promise<IpcResult<Device>>
    // `ovd reboot --device <id>`: resolves once the device is back online (or the wait failed).
    reboot(id: string): Promise<IpcResult<RebootResult>>
    // Main pushes every change while the window is visible; returns an unsubscribe.
    onChange(listener: (update: DevicesUpdate) => void): () => void
  }
  vvd: {
    // Resolves once VDA lists the Virtual Device online, with emulator gRPC on or why not.
    start(): Promise<IpcResult<VvdStartResult>>
    stop(): Promise<IpcResult<VvdState>>
    enableDeveloperMode(): Promise<IpcResult<{ developerMode: true }>>
  }
  pairing: {
    // Switches the stick on USB to TCP/IP and connects to it (`ovd pair --usb`).
    pairUsb(): Promise<IpcResult<Device>>
    // Connects to `<ip>:<port>` and remembers it (`ovd pair <ip>:<port>`).
    pair(address: string): Promise<IpcResult<Device>>
    connect(id: string): Promise<IpcResult<Device>>
    // Switches a stick OVD paired over USB back to USB first, when it is online.
    forget(id: string): Promise<IpcResult<ForgetResult>>
  }
  project: {
    // The open project folder or .vpkg; null in no-project mode with nothing loaded.
    current(): Promise<IpcResult<ProjectMode | null>>
    // Opens a folder or .vpkg path (a dropped file), as `ovd open <path>` does.
    open(path: string): Promise<IpcResult<ProjectMode>>
    // Native pickers run in main; null when the user cancels.
    pickFolder(): Promise<IpcResult<ProjectMode | null>>
    pickVpkg(): Promise<IpcResult<ProjectMode | null>>
    // The path of a dropped file; the renderer gets no file paths otherwise.
    pathForFile(file: File): string
  }
  packages: {
    // Reads a .vpkg with vpt, as `ovd pkg info <path>` does.
    info(path: string): Promise<IpcResult<PackageInfo>>
    // The open project's builds, newest first, as `ovd pkg list` lists them.
    builds(): Promise<IpcResult<PackageBuild[]>>
    // The native picker; resolves with the chosen path, null when the user cancels.
    pick(): Promise<IpcResult<string | null>>
  }
  install: {
    // The architecture guard for a package on a device, with the matching recent build.
    check(path: string, device: string): Promise<IpcResult<ArchCheck>>
    // Installs behind the guard, as `ovd apps install <path> --device <id>` does.
    install(path: string, device: string): Promise<IpcResult<InstallResult>>
    // The package `ovd apps reinstall <app> --device <id>` would install, without installing it.
    resolve(
      app: string,
      device: string
    ): Promise<IpcResult<Pick<PackageBuild, 'path' | 'displayPath' | 'file'>>>
  }
  apps: {
    // Side-loaded and Appstore apps on a device with their running state, as `ovd apps --device <id>` lists them.
    list(device: string, running?: boolean): Promise<IpcResult<AppList>>
    // One app with its components, as `ovd apps info <app> --device <id>` shows it.
    info(app: string, device: string): Promise<IpcResult<AppDetails>>
    // `ovd apps launch <app> --device <id>`.
    launch(app: string, device: string): Promise<IpcResult<LaunchResult>>
    // `ovd apps terminate <app> --device <id>`, with `--force` when `force` is set.
    terminate(app: string, device: string, force?: boolean): Promise<IpcResult<TerminateResult>>
    // `ovd apps restart <app> --device <id>`.
    restart(app: string, device: string): Promise<IpcResult<RestartResult>>
    // `ovd apps uninstall <app> --device <id>`.
    uninstall(app: string, device: string): Promise<IpcResult<UninstallResult>>
    // `ovd apps reinstall <app> --device <id>`.
    reinstall(app: string, device: string): Promise<IpcResult<ReinstallResult>>
  }
  setup: {
    // Asks `vega devmode login --json` without waiting for a sign-in.
    signedIn(): Promise<IpcResult<boolean>>
    // Resolves once signed in; while it waits, `onLoginPrompt` gets the link and code to show.
    login(): Promise<IpcResult<{ signedIn: true }>>
    onLoginPrompt(listener: (prompt: LoginPrompt) => void): () => void
    enable(code: string, vendor?: string): Promise<IpcResult<EnableResult>>
    // Resolves with the stick once it is back on USB after the reboot.
    waitForStick(): Promise<IpcResult<Device>>
    // Stops a sign-in or wait in progress (the wizard closed).
    cancel(): Promise<void>
  }
  logs: {
    // Starts `ovd logs --device <id>` for the device, or replays the running session's state
    // and entries when it is already for that device.
    open(device: string): Promise<IpcResult<LogsState>>
    // Stops the session and starts a new one (buffer cleared, filters kept).
    restart(device: string): Promise<IpcResult<LogsState>>
    // Re-filters the buffer without restarting the stream; INVALID_LOG_FILTER for a bad regex.
    setFilter(filter: LogsFilter): Promise<IpcResult<null>>
    // The footer toggle: restart the stream after every install OVD makes, for the running
    // session and every later one.
    setRestartAfterInstall(on: boolean): Promise<IpcResult<LogsState>>
    clear(): Promise<void>
    // Saves the shown lines (up to `throughSeq`) in `format`, after the native save dialog.
    export(request: LogsExportRequest): Promise<IpcResult<LogsExportResult>>
    onUpdate(listener: (update: LogsUpdate) => void): () => void
  }
  run: {
    // `ovd run --device <id>`: installs the open project's build (or .vpkg) for the device,
    // follows its log and launches it, verified. An unverified launch is returned, not an error.
    start(device: string): Promise<IpcResult<RunOutcome>>
    onProgress(listener: (progress: RunProgress) => void): () => void
  }
  input: {
    // Opens the input session for the device (a stick's console starts), or replays the open
    // one when it is for that device. Resolves with the state once it is ready or failed.
    open(device: string): Promise<InputState>
    // `ovd input press <key> --device <id>` through the open session.
    press(key: RemoteKey): Promise<InputOutcome>
    // `ovd input text "<text>" --device <id>` through the open session.
    text(text: string): Promise<InputOutcome>
    state(): Promise<InputState>
    onState(listener: (state: InputState) => void): () => void
  }
  screenshot: {
    // `ovd screenshot --clipboard --device <id>`: saved in the captures folder, then copied.
    take(device: string): Promise<IpcResult<ScreenshotTaken>>
    // The captures folder's newest PNGs, newest first.
    captures(): Promise<IpcResult<CapturesList>>
    // Shows a capture in the file manager (view-only).
    reveal(path: string): Promise<IpcResult<null>>
    // Opens the captures folder, created when missing.
    openFolder(): Promise<IpcResult<null>>
    // Main pushes the list after each take.
    onCaptures(listener: (list: CapturesList) => void): () => void
  }
  screen: {
    // Starts the live view of the device (logged once as `screen.live`), or replays the one
    // already running for it. Resolves with the state at once; frames and states are pushed.
    start(device: string): Promise<ScreenState>
    // Ends the live view (the screen unmounted).
    stop(): Promise<void>
    // The renderer drew (or dropped) frame `seq`: main may send the next one.
    ack(seq: number): Promise<void>
    // A stick's Refresh, `ovd screenshot --device <id>`: saved in the captures folder (no
    // clipboard), then the captures list is pushed.
    refresh(device: string): Promise<IpcResult<ScreenRefreshed>>
    // The PNG of a capture in the captures folder.
    image(path: string): Promise<IpcResult<Uint8Array>>
    onFrame(listener: (frame: ScreenFramePush) => void): () => void
    onState(listener: (state: ScreenState) => void): () => void
  }
  crashes: {
    // `ovd crashes --device <id>`: the crash reports of the developer's apps, newest first.
    list(device: string): Promise<IpcResult<CrashesList>>
    // One report with its stack (view-only).
    detail(ref: CrashRef): Promise<IpcResult<CrashDetailResult>>
    // `ovd crash pull <id> --device <id>`: always a real pull into the crashes folder.
    pull(ref: CrashRef): Promise<IpcResult<CrashPullResult>>
    // Copies the host path of the report to the clipboard, pulling it first when needed.
    copyPath(ref: CrashRef): Promise<IpcResult<CrashCopied>>
    // Copies the agent prompt (`agentPrompt`), pulling the report first when needed.
    copyPrompt(ref: CrashRef): Promise<IpcResult<CrashCopied>>
    // Shows the downloaded report in the file manager (view-only).
    reveal(ref: CrashRef): Promise<IpcResult<null>>
    // Main's watcher pushes each new report while the window is visible.
    onNew(listener: (event: CrashNewEvent) => void): () => void
  }
  watch: {
    // `ovd run --watch --device <id>` without the first run: watches the open project folder and
    // redeploys each new build on the target. Idempotent; NOT_A_PROJECT without a folder open.
    set(on: boolean): Promise<IpcResult<WatchState>>
    state(): Promise<WatchState>
    onEvent(listener: (event: WatchEvent) => void): () => void
  }
}

export const channels = {
  appInfo: 'ovd:app-info',
  sdkInfo: 'ovd:sdk:info',
  doctorRun: 'ovd:doctor:run',
  devicesList: 'ovd:devices:list',
  devicesRename: 'ovd:devices:rename',
  devicesChanged: 'ovd:devices:changed',
  devicesReboot: 'ovd:devices:reboot',
  targetSet: 'ovd:target:set',
  vvdStart: 'ovd:vvd:start',
  vvdStop: 'ovd:vvd:stop',
  vvdDevmodeEnable: 'ovd:vvd:devmode-enable',
  pairUsb: 'ovd:pair:usb',
  pairAddress: 'ovd:pair:address',
  connect: 'ovd:connect',
  forget: 'ovd:forget',
  projectCurrent: 'ovd:project:current',
  projectOpen: 'ovd:project:open',
  projectPickFolder: 'ovd:project:pick-folder',
  projectPickVpkg: 'ovd:project:pick-vpkg',
  packagesInfo: 'ovd:packages:info',
  packagesBuilds: 'ovd:packages:builds',
  packagesPick: 'ovd:packages:pick',
  installCheck: 'ovd:install:check',
  install: 'ovd:install',
  installResolve: 'ovd:install:resolve',
  appsList: 'ovd:apps:list',
  appsInfo: 'ovd:apps:info',
  appsLaunch: 'ovd:apps:launch',
  appsTerminate: 'ovd:apps:terminate',
  appsRestart: 'ovd:apps:restart',
  appsUninstall: 'ovd:apps:uninstall',
  appsReinstall: 'ovd:apps:reinstall',
  setupSignedIn: 'ovd:setup:signed-in',
  setupLogin: 'ovd:setup:login',
  setupLoginPrompt: 'ovd:setup:login-prompt',
  setupEnable: 'ovd:setup:enable',
  setupWait: 'ovd:setup:wait',
  setupCancel: 'ovd:setup:cancel',
  logsOpen: 'ovd:logs:open',
  logsRestart: 'ovd:logs:restart',
  logsFilter: 'ovd:logs:filter',
  logsRestartAfterInstall: 'ovd:logs:restart-after-install',
  logsClear: 'ovd:logs:clear',
  logsExport: 'ovd:logs:export',
  logsUpdate: 'ovd:logs:update',
  run: 'ovd:run',
  runProgress: 'ovd:run:progress',
  watchSet: 'ovd:watch:set',
  watchState: 'ovd:watch:state',
  watchEvent: 'ovd:watch:event',
  inputOpen: 'ovd:input:open',
  inputPress: 'ovd:input:press',
  inputText: 'ovd:input:text',
  inputState: 'ovd:input:state',
  inputUpdate: 'ovd:input:update',
  screenshotTake: 'ovd:screenshot:take',
  screenshotCaptures: 'ovd:screenshot:captures',
  screenshotCapturesUpdate: 'ovd:screenshot:captures-update',
  screenshotReveal: 'ovd:screenshot:reveal',
  screenshotOpenFolder: 'ovd:screenshot:open-folder',
  screenStart: 'ovd:screen:start',
  screenStop: 'ovd:screen:stop',
  screenAck: 'ovd:screen:ack',
  screenRefresh: 'ovd:screen:refresh',
  screenImage: 'ovd:screen:image',
  screenFrame: 'ovd:screen:frame',
  screenState: 'ovd:screen:state',
  crashesList: 'ovd:crashes:list',
  crashesDetail: 'ovd:crashes:detail',
  crashesPull: 'ovd:crashes:pull',
  crashesCopyPath: 'ovd:crashes:copy-path',
  crashesCopyPrompt: 'ovd:crashes:copy-prompt',
  crashesReveal: 'ovd:crashes:reveal',
  crashesNew: 'ovd:crashes:new'
} as const
