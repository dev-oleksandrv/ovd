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
| `vega-device-launch-app/launched.txt` | `vega device launch-app -a com.example.player.main --device <id>` (stdout, exit 0, 2 s; 1 s on the Virtual Device): the SDK force-stops the app first, so a running app gets a new pid. Recorded with `com.example.hellovega` (pure JS, Release armv7), renamed to `com.example.player` | Fire TV Stick 4K Select | 2026-11-07 |
| `vega-device-launch-app/not-installed.stderr.txt` | same for an app that isn't installed (stderr, **exit 3**); the Virtual Device prints the same | Fire TV Stick 4K Select | 2026-11-07 |
| `vega-device-launch-app/device-not-found.stderr.txt` | same with `--device <serial>` of a stick that isn't connected (stderr, **exit 2**) | — | 2026-11-07 |
| `vega-device-uninstall-app/uninstalled.txt` | `vega device uninstall-app -a com.example.player --device <id>` (stdout, exit 0, 4 s; 1 s on the Virtual Device), the app running; afterwards `vpm info com.example.player --package` exits 248. Recorded with `com.example.hellovega`, renamed | Fire TV Stick 4K Select | 2026-11-07 |
| `vega-device-uninstall-app/not-installed.stderr.txt` | same for an app that isn't installed (stderr, **exit 3**) | Fire TV Stick 4K Select | 2026-11-07 |
| `vega-device-uninstall-app/device-not-found.stderr.txt` | same with `--device <serial>` of a stick that isn't connected (stderr, **exit 2**) | — | 2026-11-07 |
| `vlcm-terminate-app/stopped.txt` | `… shell vlcm terminate-app --pkg-id com.example.player` (stdout, exit 0), the app running. Recorded with `com.example.hellovega`, renamed | Fire TV Stick 4K Select | 2026-11-07 |
| `vlcm-terminate-app/not-running.txt` | same, the app stopped (stdout, **exit 255**); the same for a package that isn't installed, and on the Virtual Device | Fire TV Stick 4K Select | 2026-11-07 |
| `vlcm-terminate-app/force-stopped.txt` | `… shell vlcm terminate-app --force --pkg-id com.example.player` (stdout, exit 0): the same whether or not the app runs | Fire TV Stick 4K Select | 2026-11-07 |
| `vlcm-crash-history/stick-empty.txt` | `… shell vlcm crash-history` (exit 0): `AppCrashInfoBuffer`, capacity 10, size 0 | Fire TV Stick 4K Select — no crash since boot | 2026-11-07 |
| `vlcm-crash-history/stick-one.txt` | same, about 1 s after `launch-app` of an app that throws right after start (Release armv7). One entry per crash, newest first: pid, packageId, timestamp (uptime), version, buildNumber, hadCompInFg, metadata (`LCM_KILLREASON` empty, `LCM_KILLTIME` in UTC with epoch ms). Recorded with a throwaway `com.example.crashlaunch`, renamed to `com.example.player`; host name and boot ID replaced | Fire TV Stick 4K Select | 2026-11-07 |
| `vlcm-crash-history/stick-two.txt` | same after a second crashing launch (the first after a fresh uninstall and install): entries survive the uninstall | Fire TV Stick 4K Select | 2026-11-07 |
| `vlcm-crash-history/virtual-device-before.txt` | same, before a launch: an earlier crash of the player and one of a system package (`com.amazon.diode`) | Virtual Device (aarch64) | 2026-11-08 |
| `vlcm-crash-history/virtual-device-after.txt` | same after `launch-app` of the crashing player (the app never shows in `vlcm list`): the new entry first | Virtual Device (aarch64) | 2026-11-08 |
| `loggingctl-vault-ls/stick-tombstones.json` | `… shell loggingctl vault --ls SYSTEM_TOMBSTONE/acr` (exit 0): JSON, `<index>#crash_<epoch s>_<uid>_<gid>_<pid>_<signal>_<package, dots as _>.acr`, not sorted. Enrolled about 0.6 s after the crash | Fire TV Stick 4K Select (matches `stick-two.txt`) | 2026-11-07 |
| `loggingctl-vault-ls/virtual-device-tombstones-before.json` | same, before the launch (matches `virtual-device-before.txt`) | Virtual Device (aarch64) | 2026-11-08 |
| `loggingctl-vault-ls/virtual-device-tombstones-after.json` | same, after the crash (matches `virtual-device-after.txt`) | Virtual Device (aarch64) | 2026-11-08 |
| `loggingctl-vault-acr/virtual-device-crashed.txt` | `… shell "echo <base64> \| base64 -d \| sh"` with the script `loggingctl vault --cat SYSTEM_TOMBSTONE <index> \| sed -n -e "1,/^\$/p" -e "/<non_native_stack_trace>/,/<\/non_native_stack_trace>/p"` (exit 0): the ACR's header (`CrashLang`, `CrashReason`, `Process`, `Source`…) and its JS stack. The whole ACR is about 350 KB (meminfo, minidump, core dump) | Virtual Device (aarch64) (matches `virtual-device-after.txt`) | 2026-11-08 |
| `loggingctl-vault-acr/stick-crashed.txt` | the same two sections, cut from the full `loggingctl vault --cat SYSTEM_TOMBSTONE 2085` output with the same `sed` | Fire TV Stick 4K Select (matches `stick-two.txt`) | 2026-11-07 |
| `loggingctl-vault-acr/insufficient-permissions.json` | `… shell loggingctl vault --cat SYSTEM_TOMBSTONE <index>` for a crash of a package that is no longer installed (**exit 0**, status -7). An unknown index prints `No entry found for tag …`, status -8, also exit 0 | Fire TV Stick 4K Select | 2026-11-08 |
| `log-capture/started.txt` | `… shell "echo <base64> \| base64 -d \| sh"` with the script `f=$(mktemp) \|\| exit 1` / `timeout 60 loggingctl log -f -o short_precise > "$f" 2>&1 &` / `echo "$f $!"` (exit 0, 0.6 s): the capture file and the `timeout` pid. The capture outlives the `vda shell` call; `timeout` ends it after 60 s | Fire TV Stick 4K Select | 2026-11-08 |
| `log-capture/stick-crashed.txt` | `… shell "echo <base64> \| base64 -d \| sh"` with `pkill -P <pid>; kill <pid> 2>/dev/null` / `grep -e com.example.player -e '\[<crash pid>\]' -e 'PID=<crash pid>' <file> \| tail -n 200` / `rm -f <file>` (exit 0, 0.8 s), after a crashing launch: launch, the app's own JS error (logged in Release too), `acr_core_dump` "crashed with signal 6", the LCM death line. `kill <pid>` alone leaves `loggingctl` running as an orphan | Fire TV Stick 4K Select (a later crash than `stick-two.txt`) | 2026-11-08 |
| `log-capture/virtual-device-crashed.txt` | the same on the Virtual Device: the `acr_core_dump` line, no JS error line | Virtual Device (aarch64) (a later crash than `virtual-device-after.txt`) | 2026-11-08 |
| `log-capture/virtual-device-verified.txt` | the stop script with crash pid 0 (`grep -e com.example.player -e '\[0\]' -e 'PID=0' …`), after the capture was started with `timeout 200` and a launch that stayed up (the same app without its crash; `VISIBLE` with a pid 6 s later, no new crash-history entry): the launch's LCM, package manager and message router lines (exit 0) | Virtual Device (aarch64) | 2026-11-08 |
| `vlcm-list/app-idle.txt` | `… shell vlcm list --app-id com.example.player.main` right after `launch-app`: `IDLE`, **pid 0**, empty container | Fire TV Stick 4K Select | 2026-11-08 |
| `vlcm-list/app-ready.txt` | same 0.6 s later: `READY` with a pid, before the app crashes about 1 s after `launch-app` returns | Fire TV Stick 4K Select | 2026-11-08 |
