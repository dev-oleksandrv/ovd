import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DevicesUpdate } from '@ovd/core'
import { channels, type OvdApi } from './api'

const api: OvdApi = {
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
  }
}

// contextIsolation is always on (ADR 0004), so the bridge is the only way in.
contextBridge.exposeInMainWorld('ovd', api)
