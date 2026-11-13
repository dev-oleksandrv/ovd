import type { Crash } from '@ovd/core'

export const jsCrash: Crash = {
  id: 2100,
  package: 'com.example.player',
  kind: 'js',
  signal: 6,
  signalName: 'SIGABRT',
  pid: 3200,
  time: '2026-11-13T10:00:00.000Z',
  version: '1.4.2',
  build: '142',
  summary: 'Error: player deliberate crash',
  new: true
}

export const nativeCrash: Crash = {
  id: 2099,
  package: 'com.example.hellovega',
  kind: 'native',
  signal: 11,
  signalName: 'SIGSEGV',
  pid: 4100,
  time: '2026-11-13T09:00:00.000Z',
  version: '1.0.0',
  build: '1',
  summary: 'Native crash in liblcm_client',
  new: false
}
