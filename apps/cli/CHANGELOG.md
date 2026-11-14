# @ovd/cli

## 0.4.0

### Minor Changes

- fa47f09: - The desktop app tells you when one of your apps crashes: a toast within seconds, a badge on the new Crashes screen, and a list of crashes with their stack. From a crash you can download the whole report, copy its path, copy a prompt for your AI agent, or jump to the logs at the time of the crash. Only apps you installed yourself are shown.
  - `ovd crashes` lists the crash reports of your apps on the target, and `ovd crashes --watch` prints new ones as they happen. `ovd crash pull <id>` saves a report to `~/ovd/crashes` (or `--out <file or folder>`, `--force` to replace a file).
  - `ovd screenshot --out` into a symbolic link to a folder now saves into the real folder, and a symbolic link as the target file is refused, with or without `--force`.

## 0.3.0

### Minor Changes

- f52f841: - `ovd logs --export <file>` saves the log to a file instead of printing it, as plain text (the default) or as JSON lines with `--format jsonl`, one `ovd logs --json` line per entry. It won't replace an existing file unless you pass `--force`. When it stops it prints `Exported N lines to <file>`, or one result document with `--json`.
  - Desktop Logs: Export now asks for the format, plain text or JSON lines, and the command palette has "Export logs as plain text…" and "Export logs as JSON lines…". The status bar shows the matching `ovd logs … --export` command.
- a6bdc4b: - `ovd reboot` restarts the target and returns once it is back online, with `--timeout` (30–600 s, default 120) and `--json`. It exits 1 when the device doesn't come back in time, and 4 when there is no online target.
  - Devices has a "Reboot & wait" button: the device shows "Rebooting…" until it is back online, then a toast says how long it took. The remote, the live view and the log stream pick up again on their own.
  - On a Fire TV stick, rebooting and reconnecting over Wi‑Fi afterwards aren't checked on a stick yet.
- ca5099d: - `ovd input press <key...>` presses remote keys on the target, in order: `up`, `down`, `left`, `right`, `ok`, `back`, `home`, `menu`, `play-pause`, `rewind`, `fast-forward`. `ovd input text "<text>"` types text into the focused field. Both accept `--device` and `--json`. On the Virtual Device they go through emulator gRPC, which OVD turns on if needed. Home can't be sent there, and the Virtual Device types only printable ASCII. Both are refused with exit 2. On a Fire TV stick they go through `inputd-cli`; this isn't checked on a real stick yet. An unknown key or invalid text exits 2, and an offline target exits 4.
  - Desktop: a new Debug → Remote & Screen screen has a remote pad with D-pad, OK, Back, Home, Menu, rewind, play/pause and fast-forward. Pressed keys flash. The keyboard works as a remote, with a hint listing the shortcuts. "Type into TV" sends text, and keys don't fire while you type in it. An input session panel shows the backend and the commands sent. Home is disabled on the Virtual Device, and an offline target shows "Remote unavailable — <device> is offline". Each press shows its `ovd input …` command in the status bar.
- 3292d16: - `ovd run` deploys in one step: it picks the build that matches the target (a Debug build on the Virtual Device, a Release build on a stick), installs it, starts the log, launches the app, checks that it really runs, then follows its log until Ctrl+C. With `--json` the first line is the run's result, then the `ovd logs --json` lines. It exits 7 when the app crashes on launch, with the crash's cause.
  - Desktop: the title bar has a Run ▸ button for the open project or .vpkg. It shows each step as it goes, opens Logs once the app runs, and says why when it can't run (nothing open, no target, the target offline). The status bar shows the matching `ovd run --device <id>` command.
- f943331: - `ovd screenshot` saves a PNG of the target's screen to `~/ovd/captures` (or `--out <file or folder>`, `--force` to replace a file) and copies it to the clipboard with `--clipboard`. The Virtual Device is captured over emulator gRPC; Fire TV sticks through `gwsi-tool-screenshooter`, which isn't checked on a stick yet.
  - The desktop's Remote & Screen has a Screenshot button and a Captures list, and the ⌘K palette has "Take screenshot": one click saves the screen and puts it on the clipboard.
- 51c6306: - `ovd vvd start` now turns on the Virtual Device's emulator gRPC endpoint every time, also on a Virtual Device that is already running, and prints `Emulator gRPC on · :8554`. If it can't, the start still succeeds and you get a warning with a fix hint. `--json` reports it as `vvd.grpc`. This is what OVD will use to send remote keys to the Virtual Device.
  - `ovd doctor` has a new "Emulator gRPC" row: `On · :8554`, `Not running` when the Virtual Device is stopped, or `Couldn’t enable` with a hint to run `ovd vvd start`.
  - Desktop: Doctor shows the same row, with a Turn on button when gRPC is off. Starting the Virtual Device warns if gRPC couldn't be turned on. The status bar shows the matching `ovd vvd start` command.
- 5f6ccea: - `ovd run --watch` redeploys every new build: it watches the project's `build/` folder, runs once, then reinstalls and relaunches the build that fits the target each time `react-native build-vega` writes a new one, while the log keeps following. Each run prints its result (with `--json`, one `{"ok": …}` line per run), a failed redeploy doesn't stop it, and Ctrl+C ends it. A .vpkg or a package ID is refused: watching needs a project folder.
  - Logs show "Build folder changed: build/aarch64-debug/player_aarch64.vpkg" as an OVD line when a watched build folder gets a new build.
  - Desktop: the title bar has a Watch toggle next to Run ▸ when a project folder is open ("Watch off" / "Watching build/"). A new build reinstalls and relaunches the app with Run's steps and a toast. It says why it can't be turned on (no target, the target offline), and turns off when another project is opened. The status bar shows the matching `ovd run --watch --device <id>` command.

### Patch Changes

- 106c25a: The stick paths for remote input, screenshots, the screen view and reboot are built and tested but haven't yet been checked on a real Fire TV stick; everything was verified on the Vega Virtual Device. `ovd screenshot --clipboard` needs `wl-clipboard` or `xclip` on Ubuntu.

## 0.2.0

### Minor Changes

- 53c4611: Project mode and no-project mode: `ovd open <folder>` opens a Vega project (a folder with `manifest.toml` and `package.json`) and `ovd open <file.vpkg>` installs from a package without one; `ovd project` shows which, and `ovd close` forgets it. `ovd doctor` gains a Project row that runs `vega project doctor` in the project folder. The desktop adds the sidebar project card (folder, path, OS and React Native versions, or "No project" with the loaded .vpkg), drag-and-drop of a .vpkg anywhere in the window, and the Doctor Project row with "Open folder…" and Details listing every check, its fix hints, Copy output and Re-run. A subcommand missing an argument now exits 2.
- 8e7b053: Launching an app that already runs does nothing and says so (`ovd apps launch` exits 0 with `wasRunning: true`). The log viewer stays responsive with huge or many lines. Reinstall now says it clears app data. `ovd doctor` leaves no sign-in process behind, also on Ctrl+C.
- 6c22451: `ovd logs` follows the target's log with `--app`, `--system`, `--level`, `--since`, `--until`, `--grep` and `--regex`, and the desktop gains Debug → Logs.
- 27c4b11: `ovd logs` and Debug → Logs restart the log stream after every install OVD makes (turn it off with `--no-restart-after-install` or the footer toggle), reconnect by themselves when the device drops, and show OVD's own events (installs, launches, crashes, restarts, reconnects) as OVD lines.
- f766c91: Inspect .vpkg files: `ovd pkg info [file]` shows a package's ID, title, version, build, architecture (`any` for pure-JS packages), build type and SHA-384, and `ovd pkg list` lists the open project's builds. The desktop app gets the Packages screen with a drop zone, recent builds and the Overview tab.
- a729805: Act on the apps on a device: `ovd apps launch`, `ovd apps terminate [--force]`, `ovd apps restart`, `ovd apps uninstall` and `ovd apps reinstall [--force]` take a package or component ID, a .vpkg or a project folder (default: the open one), check that the app is installed, and log each action in the activity log. An app ID that isn't one (letters, digits, dots, hyphens and underscores), whether passed, read from a project's `manifest.toml` or from a .vpkg, is refused with `INVALID_APP_ID` (exit code 2) before any SDK command runs. `ovd apps install` and `ovd apps reinstall` now also accept a project folder, where they pick the build that matches the target, or a package ID of the open project or .vpkg. The desktop Apps screen gets Launch and Stop on each row, and Launch, Restart, Terminate, Force stop, Uninstall & reinstall and Uninstall in the app detail, each echoing its `ovd apps …` command.
- c947553: See the apps on a device: `ovd apps [--running] [--all]` lists the side-loaded and Appstore apps on the target with their version and running state (system apps with `--all`), and `ovd apps info [app]` shows one app with its components, by package or component ID, .vpkg or project folder. `ovd apps install` is the new name of `ovd install`, which stays as an alias. The desktop app gets the Apps screen (Installed and Running tabs, app detail with components) and a Running now card on each device.
- c7a5554: Install a .vpkg behind the architecture guard: `ovd install [file]` compares the package's architecture with the target's before installing, blocks a mismatch with an error naming both and the matching recent build (exit 6), and installs anyway with `--force`. The desktop app's Install on target shows the mismatch block with a one-click switch to the matching build.
- fc97012: Launches are verified: a crash right after launch is reported, with exit code 7 and `verified: false`.

### Patch Changes

- 674edea: - Closing the terminal while `ovd logs` or `ovd doctor` runs now stops the SDK processes OVD started, and the command exits 129.
  - `ovd logs` and the desktop's log export show control characters in device log lines as visible escapes, so an app's log can't move the cursor, recolor or reorder the terminal. `--json` keeps the text exact.
  - Desktop Logs: when the only online stick reboots and no target is remembered, the session stays on screen with its "Reconnecting" note and reconnects, instead of starting over.
  - Desktop Logs: a session that ended on a target that is now offline shows the offline state with why it ended; Restart comes back with the device.
- 2a7762a: Quitting OVD, or stopping it with a second Ctrl+C or SIGTERM, no longer leaves Vega SDK log streams or sign-in checks running.

## 0.1.0

### Minor Changes

- 5634cda: Start and stop the Vega Virtual Device and turn on its Developer Mode: `ovd vvd start | stop | status` and `ovd vvd devmode enable`, plus Start/Stop in the desktop device detail, the Devices empty state, first run and the palette, and an Enable fix in Doctor when the Virtual Device has Developer Mode off.
- 030627b: Add `ovd doctor` and the desktop Doctor: checks the Vega SDK, VDA, devices, Developer Mode sign-in, Metro ports and Node, and opens on a first-run setup screen until the SDK and VDA work.
- 30d4dd8: Set up a new Fire TV stick: `ovd setup-stick` signs in to Amazon Developer Services in the browser (`vega devmode login`), turns on Developer Mode with the code the TV shows (`--code`, `--vendor`) and waits for the stick to come back on USB after its reboot (`--wifi` stops there for `ovd pair`). The desktop adds the setup wizard, opened from the target picker, the Devices hint and empty state, Doctor, the palette and the pairing wizard.
- 5048f5f: Pair Fire TV sticks over Wi‑Fi: `ovd pair --usb` switches a stick on USB to TCP/IP and connects to it, `ovd pair <ip>[:port]` connects to a stick already listening, and paired devices are remembered (`ovd connect <id>`; `ovd forget <id>` switches a stick paired over USB back to USB). The desktop adds the pairing wizard (Devices, target picker, palette), Reconnect and Forget on saved offline devices, and reconnects saved devices at launch and on Rescan.
- 5f492e3: Add `ovd devices`, `ovd device info|rename` and `ovd target`, and the desktop Devices screen.

## 0.0.1

### Patch Changes

- bf631e6: First build of OVD: the `ovd` CLI and the desktop app start, and `ovd hello` checks that everything is wired up.
