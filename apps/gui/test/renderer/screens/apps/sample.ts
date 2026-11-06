import type { AppList, InstalledApp } from '@ovd/core'

export const player: InstalledApp = {
  packageId: 'com.example.player',
  title: 'Sample Player',
  version: '1.4.2',
  buildNumber: 142,
  installedAt: '2026-11-05T14:02:00.000Z',
  updatedAt: '2026-11-05T14:02:00.000Z',
  source: 'sideloaded',
  components: [
    {
      id: 'com.example.player.main',
      running: {
        pid: 4182,
        state: 'VISIBLE',
        lifespan: 'PERMANENT',
        container: 'framework.slice/essential/4182'
      }
    }
  ],
  status: { state: 'running', pid: 4182, lifespan: 'PERMANENT' }
}

export const hello: InstalledApp = {
  packageId: 'com.example.hellovega',
  title: 'Hello Vega',
  version: '1.0.0',
  buildNumber: 1,
  installedAt: '2026-09-30T09:00:00.000Z',
  updatedAt: '2026-09-30T09:00:00.000Z',
  source: 'sideloaded',
  components: [{ id: 'com.example.hellovega.main' }],
  status: { state: 'stopped' }
}

export function listFor(device: string, name: string, apps: InstalledApp[]): AppList {
  return { target: { id: device, name }, apps }
}
