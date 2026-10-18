import { contextBridge, ipcRenderer } from 'electron'
import { channels, type OvdApi } from './api'

const api: OvdApi = {
  appInfo: () => ipcRenderer.invoke(channels.appInfo),
  hello: () => ipcRenderer.invoke(channels.hello)
}

// contextIsolation is always on (ADR 0004), so the bridge is the only way in.
contextBridge.exposeInMainWorld('ovd', api)
