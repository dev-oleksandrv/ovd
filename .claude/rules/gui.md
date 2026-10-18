---
paths:
  - "apps/gui/**"
---

# Desktop (Electron) rules

## Processes

- `src/main/` runs `@ovd/core` in-process and exposes it over typed IPC handlers. Main owns device state, streams and the activity log subscription.
- `src/preload/` exposes one typed bridge via `contextBridge`. No `nodeIntegration`, keep `contextIsolation` on. The renderer never gets raw `ipcRenderer` or Node APIs.
- `src/renderer/` is React UI only. It never imports `@ovd/core` runtime code (types are fine), never spawns processes.
- Validate IPC payloads at the main-process boundary.
- High-volume streams (logs) are batched in main before crossing IPC; never send one IPC message per log line.

## Design

- The design is the spec: [OVD Desktop v2 in Claude Design](https://claude.ai/design/p/11662d93-ccfb-4d11-9761-b6fd499be3fd?file=OVD+Desktop+v2.dc.html). Layout, copy, states and colors come from it (ADR 0019). The maintainer makes UI changes there first, then they go to code.
- When code and design disagree, follow the design or ask the maintainer to update it. Don't improvise screens, copy or states. If you can't open the design, ask for the screen (export or screenshot) before building it.
- Dark theme only. Colors, radii and fonts come from the token file only; no hard-coded hex in components.
  - Tokens: background `#0B0E12`, text `#E7EBF0`, accent `#7CE0C3`, warning `#F2C26B`, error `#FF7A7A`, info `#7AB8FF`, muted `#8E98A6`, plus log-level colors (V, D, I, W, E).
  - Fonts: Geist for UI, Geist Mono for IDs, commands and logs. Material Symbols for icons.
- Build screens from the base components (button, icon button, tabs with underline and badge, chip, status dot with pulse, table, key–value rows, code block with Copy, toast, modal wizard with "Step N of 4", empty state). Add to the base set rather than one-off styling.

## Behavior

- **CLI echo:** every action writes its `ovd …` equivalent to the status-bar echo (copyable) and to the toast's second line (ADR 0005). No CLI equivalent means the CLI part isn't done.
- **Four states** on every screen: loading, empty (with a call to action), error (with a fix hint), and offline-target for any screen that talks to a device.
- **Sidebar grows with stages:** only shipped screens and tabs are visible. Everything else appears in the command palette as "Coming in a later version", never as a dead button (ADR 0018).
- **Toasts:** ok, error, warning, info; at most 4 on screen; auto-dismiss after ~4 s; optional action button.
- **Keyboard:** ⌘K / Ctrl+K opens the palette; Esc closes palettes, menus and dialogs. Screen keys (e.g. the Remote's arrows) never fire while an input is focused.
- **Commands shown are real:** any command printed in the UI is what core runs.
- **No impossible states:** don't draw data the SDK can't provide.
- Disabled actions show the reason (tooltip or hint), e.g. Run disabled because the target is offline.

## Performance

- Log view: virtualized list over a ring buffer (~100k lines). Filter in core where possible. The UI must not freeze under a log flood.
- Polling intervals come from the design (devices 2 s, crashes 5 s, memory 1 Hz). Stop polling when the screen is hidden.
