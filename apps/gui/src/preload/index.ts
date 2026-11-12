import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { CapturesList, DevicesUpdate, LoginPrompt } from '@ovd/core'
import {
  channels,
  type InputState,
  type LogsUpdate,
  type OvdApi,
  type RunProgress,
  type WatchEvent
} from './api'

const api: OvdApi = {
  // macOS and Ubuntu only (ADR 0013).
  platform: process.platform === 'darwin' ? 'darwin' : 'linux',
  appInfo: () => ipcRenderer.invoke(channels.appInfo),
  sdk: {
    info: () => ipcRenderer.invoke(channels.sdkInfo)
  },
  doctor: {
    run: () => ipcRenderer.invoke(channels.doctorRun)
  },
  devices: {
    list: () => ipcRenderer.invoke(channels.devicesList),
    rename: (id, name) => ipcRenderer.invoke(channels.devicesRename, id, name),
    setTarget: (id) => ipcRenderer.invoke(channels.targetSet, id),
    onChange: (listener) => {
      const handler = (_event: IpcRendererEvent, update: DevicesUpdate): void => listener(update)
      ipcRenderer.on(channels.devicesChanged, handler)
      return () => ipcRenderer.removeListener(channels.devicesChanged, handler)
    }
  },
  vvd: {
    start: () => ipcRenderer.invoke(channels.vvdStart),
    stop: () => ipcRenderer.invoke(channels.vvdStop),
    enableDeveloperMode: () => ipcRenderer.invoke(channels.vvdDevmodeEnable)
  },
  pairing: {
    pairUsb: () => ipcRenderer.invoke(channels.pairUsb),
    pair: (address) => ipcRenderer.invoke(channels.pairAddress, address),
    connect: (id) => ipcRenderer.invoke(channels.connect, id),
    forget: (id) => ipcRenderer.invoke(channels.forget, id)
  },
  project: {
    current: () => ipcRenderer.invoke(channels.projectCurrent),
    open: (path) => ipcRenderer.invoke(channels.projectOpen, path),
    pickFolder: () => ipcRenderer.invoke(channels.projectPickFolder),
    pickVpkg: () => ipcRenderer.invoke(channels.projectPickVpkg),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  packages: {
    info: (path) => ipcRenderer.invoke(channels.packagesInfo, path),
    builds: () => ipcRenderer.invoke(channels.packagesBuilds),
    pick: () => ipcRenderer.invoke(channels.packagesPick)
  },
  install: {
    check: (path, device) => ipcRenderer.invoke(channels.installCheck, path, device),
    install: (path, device) => ipcRenderer.invoke(channels.install, path, device),
    resolve: (app, device) => ipcRenderer.invoke(channels.installResolve, app, device)
  },
  apps: {
    list: (device, running) => ipcRenderer.invoke(channels.appsList, device, running),
    info: (app, device) => ipcRenderer.invoke(channels.appsInfo, app, device),
    launch: (app, device) => ipcRenderer.invoke(channels.appsLaunch, app, device),
    terminate: (app, device, force) =>
      ipcRenderer.invoke(channels.appsTerminate, app, device, force),
    restart: (app, device) => ipcRenderer.invoke(channels.appsRestart, app, device),
    uninstall: (app, device) => ipcRenderer.invoke(channels.appsUninstall, app, device),
    reinstall: (app, device) => ipcRenderer.invoke(channels.appsReinstall, app, device)
  },
  setup: {
    signedIn: () => ipcRenderer.invoke(channels.setupSignedIn),
    login: () => ipcRenderer.invoke(channels.setupLogin),
    onLoginPrompt: (listener) => {
      const handler = (_event: IpcRendererEvent, prompt: LoginPrompt): void => listener(prompt)
      ipcRenderer.on(channels.setupLoginPrompt, handler)
      return () => ipcRenderer.removeListener(channels.setupLoginPrompt, handler)
    },
    enable: (code, vendor) => ipcRenderer.invoke(channels.setupEnable, code, vendor),
    waitForStick: () => ipcRenderer.invoke(channels.setupWait),
    cancel: () => ipcRenderer.invoke(channels.setupCancel)
  },
  logs: {
    open: (device) => ipcRenderer.invoke(channels.logsOpen, device),
    restart: (device) => ipcRenderer.invoke(channels.logsRestart, device),
    setFilter: (filter) => ipcRenderer.invoke(channels.logsFilter, filter),
    setRestartAfterInstall: (on) => ipcRenderer.invoke(channels.logsRestartAfterInstall, on),
    clear: () => ipcRenderer.invoke(channels.logsClear),
    export: (request) => ipcRenderer.invoke(channels.logsExport, request),
    onUpdate: (listener) => {
      const handler = (_event: IpcRendererEvent, update: LogsUpdate): void => listener(update)
      ipcRenderer.on(channels.logsUpdate, handler)
      return () => ipcRenderer.removeListener(channels.logsUpdate, handler)
    }
  },
  run: {
    start: (device) => ipcRenderer.invoke(channels.run, device),
    onProgress: (listener) => {
      const handler = (_event: IpcRendererEvent, progress: RunProgress): void => listener(progress)
      ipcRenderer.on(channels.runProgress, handler)
      return () => ipcRenderer.removeListener(channels.runProgress, handler)
    }
  },
  input: {
    open: (device) => ipcRenderer.invoke(channels.inputOpen, device),
    press: (key) => ipcRenderer.invoke(channels.inputPress, key),
    text: (text) => ipcRenderer.invoke(channels.inputText, text),
    state: () => ipcRenderer.invoke(channels.inputState),
    onState: (listener) => {
      const handler = (_event: IpcRendererEvent, state: InputState): void => listener(state)
      ipcRenderer.on(channels.inputUpdate, handler)
      return () => ipcRenderer.removeListener(channels.inputUpdate, handler)
    }
  },
  screenshot: {
    take: (device) => ipcRenderer.invoke(channels.screenshotTake, device),
    captures: () => ipcRenderer.invoke(channels.screenshotCaptures),
    reveal: (path) => ipcRenderer.invoke(channels.screenshotReveal, path),
    openFolder: () => ipcRenderer.invoke(channels.screenshotOpenFolder),
    onCaptures: (listener) => {
      const handler = (_event: IpcRendererEvent, list: CapturesList): void => listener(list)
      ipcRenderer.on(channels.screenshotCapturesUpdate, handler)
      return () => ipcRenderer.removeListener(channels.screenshotCapturesUpdate, handler)
    }
  },
  watch: {
    set: (on) => ipcRenderer.invoke(channels.watchSet, on),
    state: () => ipcRenderer.invoke(channels.watchState),
    onEvent: (listener) => {
      const handler = (_event: IpcRendererEvent, event: WatchEvent): void => listener(event)
      ipcRenderer.on(channels.watchEvent, handler)
      return () => ipcRenderer.removeListener(channels.watchEvent, handler)
    }
  }
}

// contextIsolation is always on (ADR 0004), so the bridge is the only way in.
contextBridge.exposeInMainWorld('ovd', api)
