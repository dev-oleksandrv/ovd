# SDK 0.24 fixtures

Recorded with Vega SDK 0.24.12112 and Vega CLI 1.4.5 on macOS (arm64).

| File | Command | Device | Date |
| --- | --- | --- | --- |
| `vega-version/manager.txt` | `vega --version` (Vega CLI / SDK Manager, `~/vega/bin/vega`) | — | 2026-10-20 |
| `vega-version/bundled.txt` | `vega --version` (SDK-bundled CLI, `~/vega/sdk/0.24.12112/bin/vega`) | — | 2026-10-20 |
| `vda-devices/stick-usb.txt` | `vega exec vda devices -l` | Fire TV stick over USB | 2026-10-29 |
| `vda-devices/stick-usb-and-virtual-device.txt` | `vega exec vda devices -l` | Fire TV stick over USB, Virtual Device running | 2026-10-29 |
| `vda-devices/none.txt` | `vega exec vda devices -l` | nothing attached, Virtual Device stopped | 2026-10-29 |
| `vda-devices/vda-missing-errno.txt` | `vega exec vda devices -l` (stdout, exit 2) | intermittent Vega CLI 1.4.5 failure; the next run succeeded | 2026-10-29 |
| `vega-device-info/stick-usb.json` | `vega device info --device <serial>` | Fire TV stick over USB | 2026-10-29 |
| `vega-device-info/virtual-device.json` | `vega device info --device VirtualDevice` | Virtual Device (aarch64) | 2026-10-29 |
| `vega-device-info/unavailable.json` | `vega device info --device NOPE` (exit 0) | unknown ID; booting or ambiguous targets print the same | 2026-10-29 |
| `vega-virtual-device-status/running.json` | `vega virtual-device status` (stdout) | Virtual Device running | 2026-10-29 |
| `vega-virtual-device-status/stopped.json` | `vega virtual-device status` (stdout) | Virtual Device stopped | 2026-10-29 |
| `vega-sdk-config-doctor/ok.json` | `vega sdk config doctor --json` | — | 2026-10-29 |
| `vda-version/ok.txt` | `vega exec vda version` | — | 2026-10-29 |
| `vega-device-is-port-forwarded/false.txt` | `vega device is-port-forwarded --device <id> --port 8081 --forward false` | Fire TV stick over USB (the Virtual Device prints the same) | 2026-10-29 |
| `vega-device-is-port-forwarded/unknown-device.stderr.txt` | same with `--device NOPE` (stderr, exit 1) | unknown ID | 2026-10-29 |
| `vega-devmode-login/signed-in.json` | `vega devmode login --json` (stdout, exit 2 in 0.2 s) | — signed in | 2026-10-29 |
| `vega-devmode-login/signed-out.json` | `vega devmode login --json` (stdout printed at once, then waits; stopped after 5 s; no browser opens) | — signed out; user code replaced | 2026-10-29 |
| `vega-devmode-login/bundled-cli.stderr.txt` | `vega devmode login --json` with the SDK-bundled `vega` (stderr first line, exit 253) | — | 2026-10-29 |
| `vsm-developer-mode/enabled.txt` | `vega exec vda -s emulator-5554 shell vsm developer-mode` | Virtual Device (a stick prints the same) | 2026-10-29 |
| `vega-virtual-device-start/started.txt` | `vega virtual-device start` (stdout, exit 0 in 5.7 s; stderr has SDK log lines only) | Virtual Device stopped | 2026-10-30 |
| `vega-virtual-device-start/already-running.stderr.txt` | same, last stderr line (**exit 0**, nothing on stdout) | Virtual Device already running | 2026-10-30 |
| `vega-virtual-device-stop/not-running.stderr.txt` | `vega virtual-device stop`, last stderr line (exit 1) | Virtual Device stopped | 2026-10-30 |
| `vsm-developer-mode/disabled.txt` | `vega exec vda -s emulator-5554 shell vsm developer-mode` | Virtual Device with Developer Mode off (after a restart) | 2026-10-30 |
| `vsm-developer-mode/shell-service-down.stderr.txt` | same (stderr, exit 1) | right after `vsm developer-mode disable`, until the Virtual Device restarts; `vega device info` prints `unavailable.json` meanwhile | 2026-10-30 |
| `vsm-developer-mode-set/enabled.txt` | `vega exec vda -s emulator-5554 shell vsm developer-mode enable` (exit 0; same when already on) | Virtual Device | 2026-10-30 |
| `vsm-developer-mode-set/disabled.txt` | `… vsm developer-mode disable` (exit 0) | Virtual Device | 2026-10-30 |
| `vega-device-info/virtual-device-developer-mode-off.json` | `vega device info --device VirtualDevice` | Virtual Device with Developer Mode off | 2026-10-30 |
| `vda-tcpip/restarting.txt` | `vega exec vda -s <serial> tcpip 5555` (exit 0); the USB entry leaves `vda devices -l` at once (`vda-devices/none.txt`) and stays gone, across a power cycle, until `vda usb` | Fire TV stick over USB | 2026-10-30 |
| `vda-tcpip/device-not-found.stderr.txt` | same, run again (stderr, exit 1) | stick already in TCP/IP mode | 2026-10-30 |
| `vda-usb/restarting.txt` | `vega exec vda -s <ip>:5555 usb` (exit 0); the USB entry is back 5 s later (`vda-devices/stick-usb-and-wifi-offline.txt`) | Fire TV stick over Wi‑Fi | 2026-10-30 |
| `vda-connect/connected.txt` | `vega exec vda connect <ip>:5555` (exit 0, 0.4 s) | stick in TCP/IP mode | 2026-10-30 |
| `vda-connect/already-connected.txt` | same, run again; `connect <ip>` without a port prints the same (exit 0) | stick connected over Wi‑Fi | 2026-10-30 |
| `vda-connect/refused.txt` | `vega exec vda connect <ip>:5556` (**exit 0**, 1.5 s) | stick listening on 5555 only | 2026-10-30 |
| `vda-connect/timed-out.txt` | `vega exec vda connect 192.0.2.1:5555` (**exit 0**, 75 s); a stick that is off on the host's own subnet prints the same after 47 s | unreachable address | 2026-10-30 |
| `vda-connect/bad-port.txt` | `vega exec vda connect <ip>:99999` (exit 0) | — | 2026-10-30 |
| `vda-connect/bad-host.txt` | `vega exec vda connect not-an-ip` (exit 0) | — | 2026-10-30 |
| `vda-disconnect/disconnected.txt` | `vega exec vda disconnect <ip>:5555` (exit 0) | stick connected over Wi‑Fi | 2026-10-30 |
| `vda-disconnect/no-such-device.stderr.txt` | same, run again (stderr, exit 1) | not connected | 2026-10-30 |
| `vda-devices/stick-wifi.txt` | `vega exec vda devices -l` | stick over Wi‑Fi (USB still plugged in, but in TCP/IP mode) | 2026-10-30 |
| `vda-devices/stick-wifi-offline.txt` | same, 10 s after the stick lost power; it stays listed `offline`, and VDA reconnects it by itself when the stick is back | stick over Wi‑Fi, powered off | 2026-10-30 |
| `vda-devices/stick-usb-and-wifi-offline.txt` | same, after `vda usb` | stick back on USB, Wi‑Fi entry left over | 2026-10-30 |
| `vda-get-serialno/stick-usb.txt` | `vega exec vda -s <serial> get-serialno` | stick over USB | 2026-10-30 |
| `vda-get-serialno/stick-wifi.txt` | `vega exec vda -s <ip>:5555 get-serialno`: prints the `IP:port`, not the serial (same when offline) | stick over Wi‑Fi | 2026-10-30 |
| `vega-device-info/stick-wifi.json` | `vega device info --device <ip>:5555`: identical to USB except `deviceName`; offline prints `unavailable.json` | stick over Wi‑Fi | 2026-10-30 |
| `vda-shell-fib-trie/stick.txt` | `vega exec vda -s <serial> shell cat /proc/net/fib_trie` (the stick has no `ip`, `ifconfig` or `getprop`; `/proc/idme` is permission denied) | stick over USB | 2026-10-30 |
| `vda-shell/stick-usb-not-found.stderr.txt` | `vega exec vda -s G070000000000001 shell vlcm list` with no device of that serial attached (stderr, **exit 1**); any `shell` command answers the same. The SDK’s “update available” notice, printed by `vega` itself, removed | — | 2026-11-06 |
| `vda-shell/stick-wifi-not-found.stderr.txt` | same with `-s 192.0.2.42:5555`, an address VDA isn’t connected to (stderr, **exit 1**) | — | 2026-11-06 |
| `vda-shell/virtual-device-not-found.stderr.txt` | same with `-s emulator-5554` after `vega virtual-device stop` (stderr, **exit 1**) | Virtual Device stopped | 2026-11-06 |
| `vega-devmode-login/signed-in-after-browser.json` | `vega devmode login --json` (stdout, exit 0 after 32 s): the `pending` object at once, then `success` once the browser sign-in finished | — signed out; user code replaced | 2026-10-31 |
| `vega-devmode-enable-device/enabled.json` | `vega devmode enable-device --code <code> --json` (exit 0, 1.4 s); the stick leaves `vda devices -l` at once and is back on USB 41 s later, with `unavailable.json` from `vega device info` for a moment | Fire TV stick showing a code, one vendor | 2026-10-31 |
| `vega-devmode-enable-device/invalid-code.json` | same with a wrong code (exit 6, 3.4 s); a malformed code, an already-used code and the text mode give the same "Invalid code" | Fire TV stick showing a code | 2026-10-31 |
| `vega-devmode-enable-device/not-signed-in.json` | same while signed out (exit 2, at once) | — | 2026-10-31 |
| `vega-project-doctor/one-warning.txt` | `vega project doctor` in the project folder (stdout, exit 0, 2 s; no stderr; leaves the project untouched; works before `npm install`) | — `helloWorld` template, `com.example.hellovega`, path replaced | 2026-10-31 |
| `vega-project-doctor/failed.txt` | same, with `[os.version] min = "9.9"` (stdout, exit 1) | — same project, edited manifest | 2026-10-31 |
| `vega-project-doctor/failed.stderr.txt` | same (stderr, the `vpt` validation error) | — same project, edited manifest | 2026-10-31 |
| `vega-project-doctor/no-project.txt` | `vega project doctor` in an empty folder (stdout, exit 1; no stderr) | — | 2026-10-31 |
| `vpt-info/player-armv7-release.json` | `vega exec vpt info --json <file>` (exit 0); no architecture and no build type in the output | — `helloWorld-rn72` + `@amazon-devices/react-native-mmkv`, `com.example.player` 1.4.2 build 142, Release armv7 | 2026-11-01 |
| `vpt-info/player-aarch64-debug.json` | same | — same project, Debug aarch64 | 2026-11-01 |
| `vpt-info/hellovega-armv7-release.json` | same | — `helloWorld-rn72`, `com.example.hellovega`, pure JS, Release armv7 | 2026-11-01 |
| `vpt-info/not-a-vpkg.stderr.txt` | same on a text file named `.vpkg` (stderr, exit 1); a missing path prints the same | — | 2026-11-01 |
| `vpt-show-contents/player-armv7.txt` | `vega exec vpt show-contents <file>` (exit 0): native modules sit under `lib/<arch>/`, the only place the architecture shows | — player, Release armv7 | 2026-11-01 |
| `vpt-show-contents/player-aarch64.txt` | same | — player, Debug aarch64 | 2026-11-01 |
| `vpt-show-contents/hellovega.txt` | same: no `lib/`; the armv7 and aarch64 packages of a pure-JS app differ only in their signatures | — hellovega, Release armv7 | 2026-11-01 |
| `vpt-dump-app-config/debug.json` | `vega exec vpt dump <file> assets/raw/keplerscript-app-config.json` (exit 0): `developmentEnabled` is `true` in Debug builds | — player, Debug aarch64 | 2026-11-01 |
| `vpt-dump-app-config/release.json` | same: `developmentEnabled` is `false` in Release builds | — player, Release armv7 | 2026-11-01 |
| `vpt-dump-app-config/missing.stderr.txt` | `vega exec vpt dump <file> assets/raw/nope.json` (stderr, exit 1): what a package without the entry prints, with the entry name it was asked for | — player | 2026-11-01 |
| `vpt-checksum/player-armv7-release.txt` | `vega exec vpt checksum <file>` (exit 0): SHA-384, not SHA-256 | — player, Release armv7 | 2026-11-01 |
| `vpt-checksum/player-aarch64-debug.txt` | `vega exec vpt checksum <file>` (exit 0) | — player, Debug aarch64 | 2026-11-01 |
| `vpt-checksum/hellovega-armv7-release.txt` | same | — hellovega, Release armv7 | 2026-11-01 |
| `vpt-dump-app-config/hellovega-release.json` | `vega exec vpt dump <file> assets/raw/keplerscript-app-config.json` (exit 0): no native libraries listed | — hellovega, Release armv7 | 2026-11-01 |
| `vega-device-install-app/installed.txt` | `vega device install-app -p <file> --device VirtualDevice` (stdout, exit 0, ~1 s; no stderr; the same when the app is already installed, and for armv7 and x86_64 builds of the same app) | Virtual Device (aarch64) — `helloWorld` (RN 0.83), `com.example.hellovega`, pure JS, Debug aarch64 | 2026-11-01 |
| `vega-device-install-app/installed-wrong-arch.txt` | same with a package whose native code is for another architecture (exit 0): the SDK installs it without any architecture check, an x86_64 build too | Virtual Device (aarch64) — `helloWorld` + `@amazon-devices/react-native-mmkv`, `com.example.player`, Release armv7 | 2026-11-01 |
| `vega-device-install-app/missing-dependency.stderr.txt` | same (stderr, exit 1): the Virtual Device lacks `keplerscript_2`, which every `helloWorld-rn72` package needs, at any architecture | Virtual Device (aarch64) — `helloWorld-rn72` player, Debug aarch64 | 2026-11-01 |
| `vega-device-install-app/device-not-found.stderr.txt` | same with `--device <serial>` of a stick that isn't connected (stderr, **exit 2**) | — | 2026-11-01 |
| `vega-device-install-app/no-such-file.stderr.txt` | same with a path that doesn't exist (stderr, exit 1), path replaced | Virtual Device | 2026-11-01 |
| `vpm-info-package-all/virtual-device-player.txt` | `vega exec vda -s emulator-5554 shell "echo <base64> | base64 -d | sh"` (exit 0, under 1 s for 41 packages, one round trip). The encoded script (`ALL_PACKAGES_SCRIPT` in `packages/core/src/deviceApps/deviceApps.ts`) runs `vpm info --package` for every package four at a time, each into its own file in a `mktemp -d` folder, then prints the files and deletes the folder: every package’s block back to back, in ID order, each starting `id:`. Side-loaded packages have `installer id: com.amazon.package-manager.cli`, system ones `…package-manager.service`. One third-party package’s block removed | Virtual Device (aarch64) — player installed | 2026-11-06 |
| `vpm-info-package-all/virtual-device.txt` | same, after `vpm uninstall com.example.player` | Virtual Device (aarch64) — no `com.example.*` app | 2026-11-06 |
| `vpm-info-package-all/stick.txt` | same on a stick (exit 0, 5–7 s for 115 packages; one `vpm info` after another took 31 s, and a plain `xargs -P4` interleaves the blocks). Store apps have `installer id: com.amazon.venezia\|<content id>`, `installer metadata`, `store id` and `tracking id`. Eight store apps removed; the ninth (an Amazon app) renamed to `com.example.player` “Example Player”, with its content, store, uuid and tracking IDs replaced by fake ones. Partner services that ship with the OS (`…netflixta…`, `…youtubeta…`) are system packages and kept | Fire TV Stick 4K Select — no side-loaded app | 2026-11-06 |
| `vpm-info-package/player.txt` | `… shell vpm info com.example.player --package` (exit 0): title under a nested `value:`, version, build number, install and update time in GMT, installer id, component ids, then the signer block (the SDK's debug certificate) | Virtual Device (aarch64) — player installed | 2026-11-06 |
| `vpm-info-package/missing.txt` | same for a package that isn't installed (stdout, **exit 248**) | Virtual Device | 2026-11-06 |
| `vpm-info-component/player-main.txt` | `… shell vpm info com.example.player.main` (exit 0): type, categories, launch type, lifespan (empty here), paths | Virtual Device (aarch64) — player installed | 2026-11-06 |
| `vpm-info-component/missing.txt` | same for a component that isn't installed (stdout, **exit 248**) | Virtual Device | 2026-11-06 |
| `vlcm-list/virtual-device-player-stopped.txt` | `… shell vlcm list` (exit 0): fixed-width table of running components — application, type (`I`/`S`), pid, id, state, lifespan, timeout, container, launch args | Virtual Device (aarch64) — player installed, not running | 2026-11-06 |
| `vlcm-list/virtual-device-player-running.txt` | same, a few seconds after `vmsgr send pkg://com.example.player.main`: the player is `VISIBLE`, `PERMANENT` | Virtual Device (aarch64) — player running | 2026-11-06 |
| `vlcm-list/app-running.txt` | `… shell vlcm list --app-id com.example.player.main` (exit 0) | Virtual Device (aarch64) — player running | 2026-11-06 |
| `vlcm-list/app-missing.txt` | same for an app that isn't installed (exit 0): the header only, as for a stopped app | Virtual Device | 2026-11-06 |
| `vlcm-list/stick.txt` | `… shell vlcm list` (exit 0): system services and the launcher’s interactive component, all `PERMANENT`. One store app’s row removed | Fire TV Stick 4K Select — no side-loaded app running | 2026-11-06 |
