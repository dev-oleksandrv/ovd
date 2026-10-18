# Architecture

## 1. Overview

OVD (Open Vega DevTools) is an open-source, editor-agnostic toolkit for Vega OS devices. Its goal: the fastest way to go from "I have a .vpkg" to "I see it running and I know what it's doing", on any Vega device, from any terminal, editor, CI job or AI agent.

The official Vega tooling can do everything, but it is spread across about ten CLIs and two shells (host and device), prints raw text, and its friendly layer lives only inside VS Code. OVD wraps those tools behind one consistent, scriptable interface.

**Users:**

| User                                      | Main job                                           | Priority  |
| ----------------------------------------- | -------------------------------------------------- | --------- |
| Indie or small-team Vega developer        | Build → install → see logs → fix, many times a day | Primary   |
| Developer porting a Fire OS (Android) app | Find adb / Logcat / scrcpy equivalents             | Secondary |
| QA engineer with a Fire TV stick          | Install a build, drive the app, capture evidence   | Secondary |
| CI pipeline                               | Automated smoke tests on every commit              | Later     |
| AI coding agent                           | Install, launch, read logs, look at the screen     | Later     |

**Constraints:**

- **Open source** (Apache-2.0), public from day one: no secrets or personal data in the repo (ADR 0015).
- **Wrap, don't reimplement:** the user's installed Vega SDK does the work; OVD never bundles it (ADR 0002).
- **Platforms:** macOS and Ubuntu only (ADR 0013).
- **Scriptable:** `--json` on every command (ADR 0006).
- **Testable without hardware:** recorded SDK outputs are the fixtures (ADR 0007).

**Non-goals:** replacing Vega Studio, the build system or the React Native debugger; Windows support while the SDK lacks it; redistributing SDK binaries; reimplementing device protocols; duplicating Amazon Builder Tools' docs search and trace analysis.

## 2. Project structure

```
packages/
  core/                    # all behavior (Stage 0)
    src/
      sdk/                 # SDK discovery, runner (execa), version detection
      adapters/            # per-tool parsers, zod schemas, versioned per SDK when output differs
      devices/             # list, info, target, Virtual Device, pairing, setup
      packages/            # vpkg info, architecture guard
      apps/                # install, launch (verified), stop, lists
      logs/                # loggingctl stream, filters, restart-after-install
      activity/            # activity log
      doctor/              # checks
      index.ts             # public API
    test/                  # mirrors src/ 1:1
apps/
  cli/                     # `ovd`: commander commands over core
  gui/                     # Electron
    src/main/              # runs core in-process, IPC handlers
    src/preload/           # typed contextBridge API
    src/renderer/          # React UI, tokens, base components, screens
  mcp/                     # stdio MCP server (Stage 7)
fixtures/
  <sdk-version>/<tool>/    # recorded, sanitized SDK outputs
docs/
  ARCHITECTURE.md · ROADMAP.md · adr/
```

`apps/mcp` arrives in Stage 7. `packages/core` exports TypeScript source and is bundled into each surface (tsup for the CLI, electron-vite for the desktop).

## 3. Dependency rules

- Dependencies flow `apps/* → packages/core`. Core never imports from `apps/`; surfaces never import each other.
- Surfaces import `@ovd/core` through its entry, never deep paths.
- Only core runs SDK tools and parses their output.
- The desktop and the MCP server call core in-process; nothing shells out to `ovd` (ADR 0001).
- The renderer never imports core runtime code and never gets Node APIs; it talks to main through the preload bridge (ADR 0004).

## 4. Core

### 4.1 SDK runner

- Discovers the SDK (`~/vega`, `vega sdk list-installed`) and its version. Device commands fail with an install hint when none is found.
- Every call goes through one runner: target injection (`-s <id>` / `VEGA_SERIAL`), timeout, `AbortSignal`, captured stdout/stderr/exit code.
- VDA runs as `vega exec vda …`. Device tools run through `vega exec vda shell` (`shell -c <component>` for component scope).
- Long-running processes (log stream, input console, memory polling) are managed: explicit start and stop, reconnect when a device drops, no orphans.

### 4.2 Adapters

- JSON modes first: `vega device info --json`, `vpt info --json`, `loggingctl vault --json-dump`, `vega sdk --json`.
- Text parsers stay small. Output is validated with `zod`. A changed format gets a new versioned adapter (ADR 0007).

### 4.3 Target

- The target is one device ID (USB serial, `IP:port` over Wi‑Fi, or the Virtual Device). It is remembered between launches. `VEGA_SERIAL` and `--device` override it.
- Paired Wi‑Fi devices are remembered and listed as `offline` while unreachable.

### 4.4 Activity log

Every device action is appended to a host-side, append-only log: time, surface, action, target, arguments, result. The desktop's Logs timeline and "Recent agent calls" read it (ADR 0011).

### 4.5 Errors

Core returns typed errors: a stable `code`, a `message` and a one-line `hint`. Surfaces format them.

## 5. CLI

- Thin `commander` layer. Human output by default; `--json` everywhere (ADR 0006).
- JSON mode: one document on stdout (JSON lines for streams), everything else on stderr. Errors: `{"ok": false, "error": {"code", "message", "hint"}}`.
- Streams stop cleanly on Ctrl+C.

**Exit codes:**

| Code | Meaning           |
| ---- | ----------------- |
| 0    | Success           |
| 1    | Failure (generic) |
| 2    | Usage error       |

Specific codes (no SDK, target offline, architecture mismatch, launch not verified) are added here when the commands that use them ship.

## 6. Desktop

- Electron + React + Vite (`electron-vite`), packaged with `electron-builder` (ADR 0004).
- **Main** runs core and exposes typed IPC handlers; batches high-volume data (logs) before IPC.
- **Preload** exposes one typed bridge; `contextIsolation` on, `nodeIntegration` off.
- **Renderer** is React UI: tokens, base components, screens.
- **Frame:** title bar (logo, version, target picker, palette search, later Run and Watch), sidebar (groups Device, Debug, Analyze, Automate, Setup), main area, status bar (SDK version, target, CLI echo with Copy).
- **Design:** [OVD Desktop v2 in Claude Design](https://claude.ai/design/p/11662d93-ccfb-4d11-9761-b6fd499be3fd?file=OVD+Desktop+v2.dc.html). UI changes happen there first, then in code.
- **Rules:** the design is the spec (ADR 0019); every action shows its CLI (ADR 0005); every screen has loading, empty, error and offline-target states; the sidebar grows with stages (ADR 0018); ⌘K / Ctrl+K palette; toasts (max 4, ~4 s).

## 7. Vega SDK capability map

What OVD builds on (SDK 0.24). Host tools run on the dev machine; device tools run through `vega exec vda shell`.

| Tool                                  | Where                 | Capabilities                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vega device`                         | Host                  | `list`, `info` (JSON: OS, arch, profile, simulated, Developer Mode), `is-connected`, `install-app` (`-p` or `--dir`, Debug/Release), `uninstall-app`, `launch-app`, `terminate-app`, `is-app-installed`, `is-app-running`, `installed-apps`, `installed-packages`, `running-apps`, `copy-to`, `copy-from`, `copy-logs`, `get-log-info`, `start/stop-log-stream`, `start/stop-port-forwarding`, `run-cmd`, `shell`, `reboot` |
| `vega devmode`                        | Host                  | `login` (browser sign-in), `enable-device --code <6-digit code>`                                                                                                                                                                                                                                                                                                                                                            |
| `vega run-app`, `vega virtual-device` | Host                  | Install + launch in one step; Virtual Device start, stop, status                                                                                                                                                                                                                                                                                                                                                            |
| `vega project`                        | Host                  | `generate`, `install --fix`, `update --dry-run`, `doctor` (non-zero exit), `update-manifest`                                                                                                                                                                                                                                                                                                                                |
| `vega sdk`                            | Host                  | Install, list, switch, uninstall versions; `vega-sdk-requirements.json` pin; `config doctor`; `--json`, `--non-interactive`                                                                                                                                                                                                                                                                                                 |
| VDA (`vega exec vda`)                 | Host                  | `devices -l`, `get-serialno`, `tcpip`, `usb`, `connect`, `disconnect`, `push`/`pull`, `wait-for-device`, `reboot`, `shell`, `shell -c <component>`, `-s <serial>`. Over TCP/IP the ID is `IP:port`                                                                                                                                                                                                                          |
| `vpm`                                 | Device                | `list packages`, `list components`, `info <id>`, `install`, `uninstall`                                                                                                                                                                                                                                                                                                                                                     |
| `vlcm`                                | Device                | `list` (pid, component state, lifespan state, container), `terminate-app --pkg-id/--pid [--force]`, crash history                                                                                                                                                                                                                                                                                                           |
| `vmsgr`                               | Device                | `send pkg://<component>?<params>` (deep links), `enforce-security`                                                                                                                                                                                                                                                                                                                                                          |
| `loggingctl`                          | Device                | `log` (follow, priority, identity, tag, boot, PID, TID, facility, since/until, package), `config` (level, rate, mute per process), `vault` (list, JSON dump, cat ACR, size, health)                                                                                                                                                                                                                                         |
| `inputd-cli`                          | Device                | Button press/long/hold/release, combos, touch, swipe, mouse, `send_text`, persistent console mode                                                                                                                                                                                                                                                                                                                           |
| Screenshot, memory                    | Device                | `gwsi-tool-screenshooter <file.png>` + `pull`; `ace_memusage` (USS/PSS/RSS per process, system)                                                                                                                                                                                                                                                                                                                             |
| `vpt`                                 | Host                  | `info --json`, `show-contents`, `unpack`, `dump <entry>`, `extract-locales`, `checksum`, `validate`, signing                                                                                                                                                                                                                                                                                                                |
| `perf`                                | Host                  | `record`, `activity-monitor`, `memory-monitor`, `kpi-visualizer` (TTFF, TTFD, fluidity, memory)                                                                                                                                                                                                                                                                                                                             |
| Emulator console, gRPC                | Host (Virtual Device) | `grpc <port>` (auth token), `sendKey`, `getScreenshot`, `network speed/delay/capture`                                                                                                                                                                                                                                                                                                                                       |

## 8. Known SDK behavior

OVD designs around these:

- A stick without Developer Mode is not listed by VDA at all (ADR 0009).
- Fire TV sticks are `armv7`; the Virtual Device matches the host, `x86_64` or `aarch64` (ADR 0008).
- `vega device launch-app` reports success for apps that crash (ADR 0012).
- A log session only sees apps installed before it started (ADR 0014). Release builds send no `console.log` output.
- On the Virtual Device, `inputd-cli` doesn't reach apps and `gwsi-tool-screenshooter` fails; emulator gRPC works, with Home unavailable. gRPC is off after every start (ADR 0010).
- `vega device info` reports no uptime or storage. `vlcm` lifespan is a state, not a duration.
- Crash and log access is scoped to the user's own app.
- Metro runs on the host; its output isn't in the device log stream.
- The KPI Visualizer fails warm starts on the Virtual Device and fails offline apps.
- GitHub's arm64 macOS runners can't start the Virtual Device (ADR 0013).

## 9. Testing

- Vitest in every package; tests mirror `src/` under each package's `test/`.
- No hardware, SDK, network or real timers in tests. Core uses a fake runner that replays fixtures from `fixtures/<sdk-version>/`.
- Fixtures are sanitized with the neutral sample data (ADR 0016).
- CLI tests assert `--json` output and exit codes. No snapshot tests.
- Real-device behavior is checked manually; the nightly SDK job covers the Virtual Device (ADR 0007).

## 10. Decisions

See [adr/README.md](adr/README.md) for the full index.
