import type {
  AppDetails,
  AppList,
  ArchCheck,
  Device,
  DevicesUpdate,
  DoctorReport,
  EnableResult,
  ErrorJson,
  ForgetResult,
  InstallResult,
  LaunchResult,
  LoginPrompt,
  PackageBuild,
  PackageInfo,
  ProjectMode,
  ReinstallResult,
  RestartResult,
  TerminateResult,
  UninstallResult,
  VvdState
} from '@ovd/core'

export interface AppInfo {
  version: string
}

export interface SdkSummary {
  sdkVersion: string
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
    // Main pushes every change while the window is visible; returns an unsubscribe.
    onChange(listener: (update: DevicesUpdate) => void): () => void
  }
  vvd: {
    // Resolves once VDA lists the Virtual Device online.
    start(): Promise<IpcResult<VvdState>>
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
}

export const channels = {
  appInfo: 'ovd:app-info',
  sdkInfo: 'ovd:sdk:info',
  doctorRun: 'ovd:doctor:run',
  devicesList: 'ovd:devices:list',
  devicesRename: 'ovd:devices:rename',
  devicesChanged: 'ovd:devices:changed',
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
  setupCancel: 'ovd:setup:cancel'
} as const
