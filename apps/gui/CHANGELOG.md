# @ovd/gui

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
- 934ec53: The desktop asks before it uninstalls or reinstalls an app, because both remove the app's data.

### Patch Changes

- 248c4ec: The desktop window now opens within a second even when its first paint is slow, so it no longer stays hidden and the device list keeps refreshing.
- 674edea: - Closing the terminal while `ovd logs` or `ovd doctor` runs now stops the SDK processes OVD started, and the command exits 129.
  - `ovd logs` and the desktop's log export show control characters in device log lines as visible escapes, so an app's log can't move the cursor, recolor or reorder the terminal. `--json` keeps the text exact.
  - Desktop Logs: when the only online stick reboots and no target is remembered, the session stays on screen with its "Reconnecting" note and reconnects, instead of starting over.
  - Desktop Logs: a session that ended on a target that is now offline shows the offline state with why it ended; Restart comes back with the device.
- 2a7762a: Quitting OVD, or stopping it with a second Ctrl+C or SIGTERM, no longer leaves Vega SDK log streams or sign-in checks running.
- Updated dependencies [53c4611]
- Updated dependencies [6c22451]
- Updated dependencies [f766c91]
- Updated dependencies [a729805]
- Updated dependencies [c947553]
- Updated dependencies [c7a5554]
- Updated dependencies [fc97012]
  - @ovd/core@0.2.0

## 0.1.0

### Minor Changes

- 5634cda: Start and stop the Vega Virtual Device and turn on its Developer Mode: `ovd vvd start | stop | status` and `ovd vvd devmode enable`, plus Start/Stop in the desktop device detail, the Devices empty state, first run and the palette, and an Enable fix in Doctor when the Virtual Device has Developer Mode off.
- 030627b: Add `ovd doctor` and the desktop Doctor: checks the Vega SDK, VDA, devices, Developer Mode sign-in, Metro ports and Node, and opens on a first-run setup screen until the SDK and VDA work.
- 30d4dd8: Set up a new Fire TV stick: `ovd setup-stick` signs in to Amazon Developer Services in the browser (`vega devmode login`), turns on Developer Mode with the code the TV shows (`--code`, `--vendor`) and waits for the stick to come back on USB after its reboot (`--wifi` stops there for `ovd pair`). The desktop adds the setup wizard, opened from the target picker, the Devices hint and empty state, Doctor, the palette and the pairing wizard.
- 1c8e72c: Add the app shell: a target picker in the title bar, the ⌘K command palette, and the SDK version and target in the status bar.
- 5048f5f: Pair Fire TV sticks over Wi‑Fi: `ovd pair --usb` switches a stick on USB to TCP/IP and connects to it, `ovd pair <ip>[:port]` connects to a stick already listening, and paired devices are remembered (`ovd connect <id>`; `ovd forget <id>` switches a stick paired over USB back to USB). The desktop adds the pairing wizard (Devices, target picker, palette), Reconnect and Forget on saved offline devices, and reconnects saved devices at launch and on Rescan.

### Patch Changes

- Updated dependencies [5634cda]
- Updated dependencies [030627b]
- Updated dependencies [30d4dd8]
- Updated dependencies [5048f5f]
  - @ovd/core@0.1.0

## 0.0.1

### Patch Changes

- bf631e6: First build of OVD: the `ovd` CLI and the desktop app start, and `ovd hello` checks that everything is wired up.
- @ovd/core@0.0.1
