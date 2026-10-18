# Roadmap

OVD is built in stages. Each stage is something you can do with the tool, usable on its own, in the CLI and the desktop app. Stages 0–3 are strictly sequential and form the first public release. From Stage 4 on, stages and sub-stages can be reordered freely. Every stage ends with a tagged release (ADR 0018).

| Stage | Name                        | You can…                                                                 | Desktop screens                                                     | Order    |
| ----- | --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------- |
| 0     | Setup                       | Work on a ready repo with agent instructions                             | Empty app frame, design tokens                                      | Fixed    |
| 1     | Connect my devices          | See every stick and the Virtual Device, set up a new stick               | App shell, Doctor (first run), Devices, setup and pairing wizards   | Fixed    |
| 2     | Get my app on the device    | Inspect, install, launch and stop a .vpkg safely                         | Packages (Overview), Apps, project card                             | Fixed    |
| 3     | See what my app is doing    | Deploy in one action and follow live logs                                | Logs, Run button, Watch toggle                                      | Fixed    |
| 4     | Control it from the desktop | Drive the TV without the physical remote, take screenshots               | Remote & Screen, Reboot & wait                                      | Flexible |
| 5     | Catch problems              | Get notified of crashes, dig deeper into logs, validate for the Appstore | Crashes, log presets and bundle, Packages tabs                      | Flexible |
| 6     | Faster dev loop             | Deep links, Metro, device shell, memory, SDK versions                    | Deep links, Shell, Performance → Memory, Environment → SDK versions | Flexible |
| 7     | Agents and CI               | Let AI agents and GitHub Actions use OVD                                 | Scenarios & MCP                                                     | Flexible |
| 8     | Performance                 | Track launch KPIs and record traces                                      | Performance → Launch KPIs, Traces & monitors                        | Flexible |
| 9     | Power-user extras           | Pick-and-choose conveniences                                             | Small additions across screens                                      | Flexible |
| 10    | Last                        | Network lab and community long tail                                      | Devices → Virtual Device → Network                                  | Last     |

The rules that apply to every stage are in `CLAUDE.md`, `.claude/rules/` and `docs/adr/`.

---

## Stage 0 — Setup

**Goal:** a repo where any later stage can be built without re-explaining the project.

### 0.1 Repo and boilerplates

- Apache-2.0 `LICENSE` and `NOTICE`.
- pnpm workspace: `packages/core`, `apps/cli`, `apps/gui` (Electron + React + Vite). `apps/mcp` comes in Stage 7.
- TypeScript, Vitest, lint and format configured once for the whole workspace.
- `fixtures/<sdk-version>/` convention for recorded SDK outputs.
- README with the "Unofficial, not affiliated with Amazon" disclaimer and supported platforms.
- `CONTRIBUTING.md`, issue templates, `good first issue` label.
- No device code yet.

**Expected:** `pnpm install && pnpm test && pnpm build` passes on a clean machine; `ovd --version` runs; the desktop app opens.

### 0.2 Design system and empty app frame

- Design tokens, fonts and icons (`.claude/rules/gui.md`).
- Base components: button, icon button, tabs with underline and badge, chip, status dot (with pulse), table, key–value rows, code block with Copy, toast, modal wizard with "Step N of 4", empty state.
- Empty frame with title bar, sidebar, main area, status bar. Dark theme only; components live in `apps/gui`.

**Expected:** the app opens to the frame with an empty sidebar; a dev-only gallery page shows every base component in every state.

### 0.3 CI

- GitHub Actions on `ubuntu-latest`: install, lint, typecheck, test, build.
- Release workflow: publish to npm and attach desktop builds when a tag is pushed.

**Expected:** every PR shows green or red checks; a test tag produces a dry-run release.

### 0.4 Agent instructions

- `CLAUDE.md`, path-scoped `.claude/rules/`, the `/ship` skill, `docs/ARCHITECTURE.md`, this roadmap and the ADRs.
- The desktop design linked from the docs: [OVD Desktop v2 in Claude Design](https://claude.ai/design/p/11662d93-ccfb-4d11-9761-b6fd499be3fd?file=OVD+Desktop+v2.dc.html), with the screen → stage map below.

**Expected:** a fresh Claude Code session can add a trivial `ovd hello --json` command end to end (core, CLI, a desktop toast with the CLI echo, test) using only the repo.

**Done when:** 0.1–0.4 are complete and the first tag is released.

---

## Stage 1 — Connect my devices

**Goal:** you always know which devices you have, which one a command will hit, and how to get a new stick working.

**Sidebar after:** Device → Devices · Setup → Doctor.

### 1.1 App shell

- Title bar: logo and version; target picker (name, architecture, connection) listing devices with status, ending with "Set up a new stick…" and "Pair a device over Wi‑Fi…"; "Search or run a command ⌘K". Run and Watch are placeholders until Stage 3.
- Sidebar groups: Device, Debug, Analyze, Automate, Setup, with badges.
- Status bar: SDK version, target name and architecture, CLI echo `$ ovd …` with Copy.
- Command palette: go to screen, this stage's actions, devices ("set as target"), "Coming in a later version" entries.
- Toasts.

**Expected:** every screen is reachable from the sidebar and the palette; changing the target updates the title bar and status bar and echoes `ovd target set <id>`.

### 1.2 Doctor and first run

- CLI `ovd doctor`: Vega SDK (`vega --version`, `vega sdk config doctor`), VDA (`vega exec vda version`), devices (`vega device list`), Developer Mode hints (link to the setup wizard), Metro ports 8081 and 8097 (free, in use, reversed or not). Each failure prints a one-line fix.
- Desktop first run ("Set up OVD"): four checks in order, Vega SDK → VDA → Devices → Project. Each waits for the previous one and has Re-check and its own call to action ("Install the Vega SDK ↗"; "Start the Virtual Device" / "Set up a Fire TV stick"; "Open a project folder" / "Drop a .vpkg"). All passed: "Setup complete — OVD is ready." → Go to Devices.
- Doctor stays the start screen until checks pass; navigating away bounces back and highlights the failing check.
- After setup (Environment → Doctor): summary ("All checks passed" / "N failing · M warnings"), "Run ovd doctor", rows for Vega SDK, VDA, Devices, Developer Mode ("Set up" opens the wizard) and Metro (report only). Header shows host info (OS, arch, Node).
- Doctor never changes anything; it only reports.

**Expected:** without the SDK, first run shows only the SDK check with an install link. With the SDK and no devices, it explains that a stick without Developer Mode isn't listed. `ovd doctor --json` and the Doctor screen agree.

### 1.3 Devices screen

- CLI: `ovd devices`, `ovd device info <id>`, `ovd target set <id>`; respects `VEGA_SERIAL`.
- List: "Discovered over USB, TCP/IP and the local Virtual Device · refreshes every 2 s"; Rescan; Pair over Wi‑Fi. Rows: icon, name, connection · architecture · OS, status dot, Target badge; offline devices dimmed. Hint: "Stick plugged in but not listed? Set up Developer Mode →". Empty state: "No devices yet" with Start the Virtual Device and Set up a Fire TV stick.
- Detail: name, status, kind, ID, serial (`vda get-serialno`); "Use as target"; info rows OS, Build, Architecture, Profile, Connection (+ IP), Serial; "Running now" (filled in Stage 2); `vega device info --json` block with Copy.
- No uptime or storage. The target is remembered between launches.

**Expected:** `ovd devices --json` lists every connected device with OS, architecture, connection and serial. Unplugging a stick updates the desktop within 2 s.

### 1.4 Virtual Device start / stop

- CLI `ovd vvd start | stop | status`. Desktop Start/Stop on the Virtual Device's detail ("The Virtual Device is stopped."), the palette and the Doctor Devices check.

**Expected:** `ovd vvd start` returns once the device is ready and listed; stop removes it; the button shows progress.

### 1.5 Set up a new stick (wizard)

- CLI `ovd setup-stick`; desktop modal, Step N of 4:
  1. On the TV: Settings → My Fire TV → About; select the device name 7 times; Developer options → Developer Mode → Continue; leave the 6-digit code on screen.
  2. Sign in: `vega devmode login` opens the browser; "Waiting for sign-in…" → "Signed in · <email>".
  3. Enter the code: runs the enable command (shown); "Enabling Developer Mode…" → "The device is rebooting · Waiting for device…".
  4. Connect: USB or Wi‑Fi (continues in the pairing wizard); "Waiting for the stick to appear…" → "<name> · <serial> · USB · armv7 — now in Devices".
- Error states with retry: not signed in, code wrong or expired, different networks, firewall / blocked port.
- Virtual Device: no wizard; one-click `vsm developer-mode enable` from Doctor and the device detail.
- Entry points: target picker, Devices hint and empty state, Doctor, palette. OVD never stores Amazon credentials.

**Expected:** a brand-new stick goes from "not listed" to listed by following the wizard alone; every error state can be triggered and recovered from.

### 1.6 Pair over Wi‑Fi (wizard)

- CLI `ovd pair --usb` / `ovd pair <ip>[:port]`; desktop modal, Step N of 4:
  1. Route: with USB (OVD switches the stick to TCP/IP) or without USB (Connection Mode on the TV). Both need Developer Mode.
  2. USB: plug in, `vega exec vda tcpip 5555`, unplug. No USB: Developer Options → Connection Mode → TCP/IP, port above 1024, wait for reboot (latest OS only).
  3. Connect by IP and port, validated ("Port must be a number above 1024").
  4. Paired: device card "Now in Devices".

**Expected:** a stick with Developer Mode pairs by either route and appears in Devices.

### 1.7 Saved Wi‑Fi devices

- Paired devices are remembered; unreachable ones stay listed as offline with Reconnect. CLI `ovd devices` shows `offline`; `ovd connect <id>`.

**Expected:** a saved stick reconnects after a host restart without retyping its address.

**Done when:** a new user installs OVD, passes first run, sets up a stick and sees it next to the Virtual Device, from both surfaces.

---

## Stage 2 — Get my app on the device

**Goal:** install and manage apps without remembering which tool does what, and never install the wrong build.

**Sidebar after:** Device → Devices, Apps, Packages · Setup → Doctor.

### 2.1 Project card and no-project mode

- Sidebar bottom: project card (folder, path, "SDK pinned 0.24.x · RN 0.72") or "No project" with "Drop a .vpkg" / "Open a project folder…".
- CLI `ovd open <folder>`; commands accept `--vpkg <file>` without a project.
- Doctor gets the Project row (`vega project doctor` summary, or "No project open · installing from <file>").

**Expected:** opening a folder or dropping a .vpkg switches modes; Run and Packages follow.

### 2.2 Packages → Overview

- CLI `ovd pkg info <file>` (from `vpt info --json`).
- Drop zone ("Drop a .vpkg here", "or watch build/"); "Recent builds" (file, architecture chip, Debug/Release, size, time); detail with title, version (build), path, "Install on target"; Overview tab with key–value rows and the `vpt info --json` block. Only Overview is visible.

**Expected:** dropping any .vpkg shows ID, title, version, build and architecture within a second.

### 2.3 Architecture guard

- Before every install, compare package and target architecture (ADR 0008). Desktop: red block "Architecture mismatch: package is aarch64, Fire TV Stick 4K Select is armv7. Install is blocked." with a fix that switches to a matching recent build. CLI: error naming both; `--force` overrides.

**Expected:** an `aarch64` package on an `armv7` stick is blocked in both surfaces, and the fix offers `player-1.4.2-armv7.vpkg`.

### 2.4 Apps screen

- CLI: `ovd apps [--running]`, `ovd app info`, `ovd install | reinstall | uninstall | launch | stop [--force] | restart`, each accepting a .vpkg, a package ID or a project folder (auto-finds the Debug or Release build).
- Desktop: header "On <target> · launches are verified against running-apps and crash history"; tabs "Installed · N" / "Running · N"; table (avatar, title, ID, version, status Running · pid / Stopped / Verifying… / Crashed on launch, Launch/Stop); detail actions Launch, Restart, Terminate, Force stop; info rows incl. Lifespan and Running for; "Components · vpm info / vlcm list" table; Uninstall & reinstall (note: "clears app data (to be verified)"), Uninstall.
- Devices → "Running now" fills in.

**Expected:** every action works on a stick and the Virtual Device; Running and "Running now" update within one refresh.

### 2.5 Launch verification

- After every launch, confirm with running apps and crash history (ADR 0012). Desktop: "Verifying launch…"; on failure "Launch reported success, but the app crashed" with the cause and "Logs around crash". CLI: non-zero exit, `"verified": false, "reason": "crashed"`.

**Expected:** a crash right after launch shows as "Crashed on launch", not "Running".

**Done when:** any .vpkg reaches a running app on any device without a raw SDK command, from both surfaces.

---

## Stage 3 — See what my app is doing

**Goal:** the loop you run many times a day is one action, and logs never go silent.

**Sidebar after (first public release):** Device → Devices, Apps, Packages · Debug → Logs · Setup → Doctor.

### 3.1 Logs screen

- CLI `ovd logs [--app] [--level] [--since] [--until] [--grep] [--regex]`.
- Toolbar: session label, search with regex toggle, level picker V/D/I/W/E, package filter (All / each app / System), Pause/Resume, Clear, Export.
- Rows: time, colored level, tag, pid, message with highlighted hits. Virtualized list, ring buffer ~100k lines.
- Footer: line and error counts, "N new lines" while paused or scrolled up, Follow toggle. Presets row shows only "All".
- The UI must not freeze under high volume; filter in core where possible.

**Expected:** `ovd logs --app com.example.player --level error` streams only that app's errors; the desktop stays responsive under a flood; Follow sticks to the bottom until you scroll.

### 3.2 Logs survive reinstall

- Stream restarts after every install made through OVD; footer toggle "Restart session after install", on by default (ADR 0014). Reconnects when a device drops, with an inline note.
- Release build banner: "<app> is a Release build: its JS logs are hidden…", with Dismiss.
- OVD events inline (install, "Log session restarted", launch verified, crash detected, build folder changed), from the activity log.

**Expected:** reinstall 10 times with logs open; logs keep arriving and each reinstall shows as an OVD line.

### 3.3 Export

- Plain text or JSON lines, from the toolbar, the palette and `ovd logs --export`.

**Expected:** an exported JSON-lines file can be read back line by line.

### 3.4 Run button (one-click deploy)

- CLI `ovd run` = install + launch + verify + follow logs; Ctrl+C stops cleanly.
- Title bar "Run ▸ <project>" (or the dropped .vpkg) with a live steps dropdown: found build → installing → restarting log session → launching → verifying → following logs; ends with the CLI equivalent and opens Logs.
- Picks the build matching the target (release for sticks, host-architecture debug for the Virtual Device). Disabled with a reason when the target is offline or nothing is selected.

**Expected:** .vpkg to running app with live logs in under 30 s, at least 2× faster than raw commands.

### 3.5 Watch and redeploy

- Title bar toggle "Watching build/" / "Watch off" (project open only). A new build reinstalls and relaunches, with a toast and an OVD log line. CLI `ovd run --watch`.

**Expected:** a rebuild redeploys and logs continue without manual steps.

### 3.6 First-release polish

- Palette lists Crashes, Remote & Screen, Shell, Deep links, Performance, Scenarios & MCP as "Coming in a later version".
- Loading, empty, error and offline-target states on every first-release screen.
- Homebrew tap (`brew install ovd`).

### 3.7 Nightly SDK check

- Nightly CI on `ubuntu-latest`: latest SDK, headless Virtual Device, `doctor`, `devices`, `pkg info`, `install`, `launch`, `logs` with `--json`. New fixtures recorded when the SDK version changes; a failure opens an issue (ADR 0007).

**Done when:** first-release metrics are measured (see Success metrics). Release = first public release.

---

## Stage 4 — Control it from the desktop

**Goal:** test without reaching for the physical remote. **Hardware checks first:** `inputd-cli button_press` reaches apps on a stick; stick screenshot rate.

**Sidebar adds:** Debug → Remote & Screen.

- **4.1 Virtual Device gRPC backend:** enable the emulator gRPC endpoint on every Virtual Device start (prefer vega-vvd-driver). Doctor gets "Emulator gRPC" (On · :8554 / Not running / couldn't enable). _Expected:_ after `ovd vvd start`, gRPC is on and a key reaches the device.
- **4.2 Remote and text input:** `ovd input press <key>`, `ovd input text "<text>"`. Remote pad (D-pad, OK, Back, Home, Menu, play/pause, rewind, fast-forward), keyboard hint, pressed-key flash, "Type into TV". Input session panel (backend, sent commands). Sticks via `inputd-cli`, Virtual Device via gRPC (ADR 0010); Home disabled on the Virtual Device; one persistent session; keys don't fire while typing; "Remote unavailable — <device> is offline". _Expected:_ navigate and type on both device types with immediate feedback.
- **4.3 Screenshots:** `ovd screenshot [--out] [--clipboard]`; button and palette action; saved to `~/ovd/captures` and the clipboard; Captures list. _Expected:_ one click saves a PNG from either device type.
- **4.4 Screen view:** Virtual Device live view ("Live · emulator gRPC", ~16+ fps); stick "Latest screenshot · <time>" with Refresh (marked out of date after a key press); "No signal" when offline.
- **4.5 Reboot & wait:** `ovd reboot` returns when the device is back; desktop shows "Rebooting…". _Expected:_ a stick returns to Online without manual reconnecting.

**Done when:** a QA engineer can drive an app and capture evidence without the physical remote.

---

## Stage 5 — Catch problems

**Goal:** crashes stop being silent and logs answer harder questions. **Hardware check before 5.3:** `vpt validate` output format.

**Sidebar adds:** Debug → Crashes (badge for new crashes).

- **5.1 Crash radar:** `ovd crashes [--watch]`, `ovd crash pull <id>`. Crashes screen ("loggingctl vault · scoped to your apps · polling every 5 s"): list (signal chip native/JS, app, NEW, age, summary, pid · build · device); detail with Download ACR, Copy crash report path, Copy prompt for your agent, Logs at crash time; raw stack (symbolication later). New-crash toast and OVD log line. Apps' "Crashed on launch" gets "Open crash report". Never request elevated access. _Expected:_ a crash toasts within 5 s; report on disk in one click.
- **5.2 Log power tools:** presets (All, Player errors only, Network, Lifecycle) and "Save filter"; advanced filters (PID, TID, tag, identity, facility, boot); per-process level, rate limit, mute; "Bundle" for bug reports. `ovd logs --preset <name>`, `ovd logs bundle`.
- **5.3 Packages → Manifest, Files, Validate:** manifest from `vpt dump` with line numbers and notes; `vpt show-contents` tree; `vpt validate` table (severity, message, file) with error badge and clickable lines where possible. `ovd pkg manifest | files | validate`. _Expected:_ a broken manifest shows exact errors; clicking opens the line.

**Done when:** you learn about crashes and invalid packages from OVD before users or the Appstore do.

---

## Stage 6 — Faster dev loop

**Goal:** shorter iterations, fewer trips to the terminal.

**Sidebar adds:** Debug → Shell, Deep links · Analyze → Performance (Memory) · Environment → SDK versions.

- **6.1 Deep links:** `ovd deeplink <app> [--component] key=value…`. Screen ("Launch with URI params via vmsgr"): app selector, saved presets, component picker, key = value rows, live command preview, "Send to <target>", "Save as preset", Sent history.
- **6.2 One-click Metro:** reverse 8081 and 8097; Doctor Metro row gets Connect / Disconnect. `ovd metro connect | disconnect`.
- **6.3 Shell:** `ovd shell [--component <id>]`. Context selector, snippets (running components, memory per process, installed packages, crash vault, screen size, kernel), terminal with history. Device detail → Shell opens it.
- **6.4 Performance → Memory:** `ovd mem [--app] [--watch]`. Tiles (App PSS with change vs 60 s average, Peak PSS, System used, Free), 60 s chart of PSS and USS (`ace_memusage`, 1 Hz), process table.
- **6.5 Environment → SDK versions:** `vega-sdk-requirements.json` pin card, version list with Switch / Install, "Check OS compatibility" (`vega project update --dry-run`) and "Apply fix" (`vega project install --fix`) after confirmation; Doctor's SDK row gets Switch. `ovd sdk list | install | use | pin`, `ovd compat`.

**Done when:** a typical debug session needs no raw SDK command.

---

## Stage 7 — Agents and CI

**Goal:** OVD is useful beyond one laptop.

**Sidebar adds:** Automate → Scenarios & MCP (tabs Scenarios, MCP server, CI).

- **7.1 MCP server:** `ovd mcp` over stdio with `ovd_devices`, `ovd_install`, `ovd_launch`, `ovd_terminate`, `ovd_logs_tail`, `ovd_press`, `ovd_type`, `ovd_screenshot`, `ovd_crashes`, `ovd_shell` (ADR 0017). Desktop tab: stdio explainer, Add to Claude Code (`claude mcp add ovd -- npx -y @ovd/cli mcp`) / Cursor (`.cursor/mcp.json`) / Kiro (`.kiro/settings/mcp.json`), tools list, client config, "Recent agent calls" from the activity log. _Expected:_ Claude Code installs, launches, reads logs and views a screenshot through OVD, and the desktop shows the calls.
- **7.2 Scenario scripts:** YAML in `scenarios/` with steps install, launch (verify), waitForLog, press, assertLog, screenshot; variables `${OVD_DEVICE}`, `${BUILD_DIR}`, `${ARCH}`. `ovd scenario run <file> [--device] [--json]`. Desktop tab with list, YAML view, Run with per-step status. _Expected:_ same results on a stick and the Virtual Device; clear message on the failing step.
- **7.3 GitHub Action:** headless Virtual Device smoke test on `ubuntu-latest` (ADR 0013), SDK with `NONINTERACTIVE=true` and pinned `VEGA_SDK_VERSION`. Desktop CI tab shows `.github/workflows/vega-smoke.yml` with Copy. _Expected:_ a sample `com.example.*` repo fails the build when the scenario fails.

**Done when:** an agent and a CI pipeline both run OVD without a human.

---

## Stage 8 — Performance

**Goal:** spot regressions before users do. **Hardware check:** `perf record` category names.

- **8.1 Launch KPIs:** `ovd perf kpi [--cold] [--runs 5] [--budget ttff=<ms>]`. Table per build (TTFF, TTFD, Fluidity, Memory) with a regression callout. Known KPI Visualizer failures (warm start on the Virtual Device, offline apps) are warnings.
- **8.2 Traces:** `ovd perf trace [--duration] [--categories]`. Record with timer and categories, trace list, "Open in Perfetto ↗".
- **8.3 Monitors:** activity monitor (CPU per thread, JS CPU profile with source maps); memory monitor (GC counts, heap). Output saved next to traces.

**Done when:** you can compare two builds' launch times and record a trace in one action.

---

## Stage 9 — Power-user extras

Independent items, shipped one by one. **Hardware checks:** uninstall removes app data; Virtual Device snapshots save and load; `vda pull` / shell access to app data on a production stick.

| Item                                                                             | Desktop                         |
| -------------------------------------------------------------------------------- | ------------------------------- |
| Screen recording (Virtual Device with audio; stick via ~2 fps polling, no audio) | Remote & Screen → Record        |
| Stick live view at the measured rate                                             | Remote & Screen                 |
| Reset app data (uninstall + reinstall; snapshot on the Virtual Device)           | Apps → removes "to be verified" |
| JS crash symbolication with source maps                                          | Crashes → Symbolicated          |
| File browser with push / pull and progress                                       | Device detail → Files           |
| User-defined command snippets                                                    | Shell → Snippets "Add"          |
| Run an action on all devices                                                     | Target picker "All devices"     |
| Long press, hold, button combos                                                  | Remote pad                      |
| Install history and rollback                                                     | Apps → detail                   |
| Older logs (previous boot, vault)                                                | Logs → session picker           |
| Compare two vpkgs                                                                | Packages → Compare              |

**Expected per item:** works in CLI and desktop with `--json`; the design's "Later" / "to be verified" markers are removed.

---

## Stage 10 — Last

### 10.1 Network lab

- **Hardware check first:** `network speed` / `network delay` throttle app traffic on the Virtual Device.
- Virtual Device page → Network: speed and latency presets with Apply / Reset and current state; "Packet loss is not supported by the emulator console."; packet capture to .pcap; host vs app reference measurement; emulator console log; "Start the Virtual Device to shape its network." when stopped.
- CLI `ovd net speed | delay | reset | capture`. Virtual Device only.

### 10.2 Community long tail

Plugin API · error explainer (log patterns → fix hints) · device farm view · screenshot diffs · signing and checksums · locale extraction · touch input · Appium helper · CI perf budgets beyond TTFF · split log view · packet loss via host tools · native crash GDB flow · `vmsgr enforce-security` check · optional terminal UI (`ink`).

**Done when:** never fully; this is the open backlog for contributors.

---

## Screen → stage map

| Design element                                         | Stage                                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Tokens, fonts, icons, base components, empty frame     | 0.2                                                                                                            |
| Title bar: logo, target picker, palette search         | 1.1                                                                                                            |
| Title bar: Run ▸ and steps dropdown                    | 3.4                                                                                                            |
| Title bar: Watch toggle                                | 3.5                                                                                                            |
| Sidebar navigation                                     | 1.1, grows each stage                                                                                          |
| Sidebar project card / No project                      | 2.1                                                                                                            |
| Status bar with CLI echo                               | 1.1                                                                                                            |
| Command palette (+ "Coming in a later version")        | 1.1, updated each stage                                                                                        |
| Toasts                                                 | 1.1                                                                                                            |
| Environment → Doctor: first run                        | 1.2                                                                                                            |
| Environment → Doctor: rows                             | 1.2 (SDK, VDA, Devices, Developer Mode, Metro report), 2.1 (Project), 4.1 (Emulator gRPC), 6.2 (Metro Connect) |
| Environment → SDK versions                             | 6.5                                                                                                            |
| Devices: list, empty state, detail, JSON               | 1.3                                                                                                            |
| Devices: Virtual Device start / stop                   | 1.4                                                                                                            |
| Devices: Running now                                   | 2.4                                                                                                            |
| Devices: Reboot & wait                                 | 4.5                                                                                                            |
| Devices: Shell button                                  | 6.3                                                                                                            |
| Devices: Virtual Device → Network                      | 10.1                                                                                                           |
| Set up a new stick wizard                              | 1.5                                                                                                            |
| Pair over Wi‑Fi wizard                                 | 1.6                                                                                                            |
| Packages: drop zone, recent builds, Overview           | 2.2                                                                                                            |
| Packages: architecture mismatch block                  | 2.3                                                                                                            |
| Packages: Manifest, Files, Validate                    | 5.3                                                                                                            |
| Apps: tabs, table, detail, components                  | 2.4                                                                                                            |
| Apps: verifying / crashed on launch                    | 2.5 (+ "Open crash report" in 5.1)                                                                             |
| Logs: toolbar, rows, footer, Follow                    | 3.1                                                                                                            |
| Logs: restart after install, Release banner, OVD lines | 3.2                                                                                                            |
| Logs: Export                                           | 3.3                                                                                                            |
| Logs: presets, Save filter, Bundle                     | 5.2                                                                                                            |
| Crashes                                                | 5.1 (symbolication in 9)                                                                                       |
| Remote & Screen: pad, Type into TV, input session      | 4.2                                                                                                            |
| Remote & Screen: Screenshot, Captures                  | 4.3                                                                                                            |
| Remote & Screen: live view / latest screenshot         | 4.4                                                                                                            |
| Remote & Screen: Record                                | 9                                                                                                              |
| Shell                                                  | 6.3                                                                                                            |
| Deep links                                             | 6.1                                                                                                            |
| Performance → Memory                                   | 6.4                                                                                                            |
| Performance → Launch KPIs                              | 8.1                                                                                                            |
| Performance → Traces & monitors                        | 8.2, 8.3                                                                                                       |
| Scenarios & MCP → Scenarios / MCP server / CI          | 7.2 / 7.1 / 7.3                                                                                                |

## Hardware checks

About an hour each, done just before the stage that needs them.

| Check                                                       | Before                         |
| ----------------------------------------------------------- | ------------------------------ |
| `inputd-cli button_press` reaches apps on a real stick      | Stage 4                        |
| Screenshot rate on a stick with `gwsi-tool-screenshooter`   | Stage 4 (stick live view in 9) |
| `vpt validate` output format (line numbers?)                | Stage 5.3                      |
| `perf record` category names                                | Stage 8                        |
| Uninstall removes app data                                  | Stage 9                        |
| Virtual Device snapshots save and load                      | Stage 9                        |
| `vda pull` / shell access to app data on a production stick | Stage 9                        |
| `network speed` / `network delay` throttle app traffic      | Stage 10.1                     |

## Success metrics

Starting targets, revisited after Stage 3.

| Metric                              | How                                  | Target                             |
| ----------------------------------- | ------------------------------------ | ---------------------------------- |
| .vpkg to running app with live logs | Stopwatch vs raw SDK commands        | Under 30 s, at least 2× faster     |
| Raw SDK commands in a working day   | Self-tracking over a week            | Zero for install, launch, logs     |
| "Empty logs" after reinstall        | Count while dogfooding               | Zero                               |
| Outside adoption                    | Stars, npm downloads, outside issues | Tracked from first public release  |
| Outside contributors                | Merged PRs from non-maintainers      | At least one by the end of Stage 5 |
