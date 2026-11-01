# @ovd/gui

## 0.2.0

### Minor Changes

- 53c4611: Project mode and no-project mode: `ovd open <folder>` opens a Vega project (a folder with `manifest.toml` and `package.json`) and `ovd open <file.vpkg>` installs from a package without one; `ovd project` shows which, and `ovd close` forgets it. `ovd doctor` gains a Project row that runs `vega project doctor` in the project folder. The desktop adds the sidebar project card (folder, path, OS and React Native versions, or "No project" with the loaded .vpkg), drag-and-drop of a .vpkg anywhere in the window, and the Doctor Project row with "Open folder…" and Details listing every check, its fix hints, Copy output and Re-run. A subcommand missing an argument now exits 2.
- f766c91: Inspect .vpkg files: `ovd pkg info [file]` shows a package's ID, title, version, build, architecture (`any` for pure-JS packages), build type and SHA-384, and `ovd pkg list` lists the open project's builds. The desktop app gets the Packages screen with a drop zone, recent builds and the Overview tab.

### Patch Changes

- Updated dependencies [53c4611]
- Updated dependencies [f766c91]
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
