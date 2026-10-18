# 0004. Electron for the desktop app

- Status: Accepted
- Date: 2026-10-15

## Context

The desktop app needs the full core: child processes, long-running log streams, file watching. Tauri 2 with a React UI was considered first, for its small binaries. With Tauri, the Node core would run as a separate sidecar process that the Rust shell talks to, which adds a second IPC layer, a sidecar to bundle per platform, and Rust to the contributor skill set.

## Decision

- The desktop app is Electron with React and Vite (`electron-vite`), packaged with `electron-builder`.
- Core runs in-process in the Electron main process and is exposed to the renderer through typed IPC handlers.
- The preload script exposes one typed bridge through `contextBridge`. `contextIsolation` stays on and `nodeIntegration` stays off; the renderer never gets Node APIs or raw `ipcRenderer`.
- Desktop builds: `.dmg` for macOS, `.deb` and AppImage for Ubuntu.

## Consequences

- One language and one process model across core and desktop; no sidecar.
- Larger download and memory footprint than Tauri.
- High-volume data (logs) must be batched in the main process before it crosses IPC, so the renderer stays responsive.
- Electron and its security defaults must be kept up to date.
