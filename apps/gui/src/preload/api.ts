import type {
  Device,
  DevicesUpdate,
  DoctorReport,
  ErrorJson,
  ForgetResult,
  VvdState
} from '@ovd/core'

export interface AppInfo {
  version: string
  platform: 'darwin' | 'linux'
}

export interface SdkSummary {
  sdkVersion: string
}

// Core errors cross IPC as data: Electron drops custom error fields when a handler throws.
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: ErrorJson }

// The only surface the renderer sees (ADR 0004). Every method maps to one IPC channel in main.
export interface OvdApi {
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
  forget: 'ovd:forget'
} as const
