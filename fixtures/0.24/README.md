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
| `vega-devmode-login/signed-in-after-browser.json` | `vega devmode login --json` (stdout, exit 0 after 32 s): the `pending` object at once, then `success` once the browser sign-in finished | — signed out; user code replaced | 2026-10-31 |
| `vega-devmode-enable-device/enabled.json` | `vega devmode enable-device --code <code> --json` (exit 0, 1.4 s); the stick leaves `vda devices -l` at once and is back on USB 41 s later, with `unavailable.json` from `vega device info` for a moment | Fire TV stick showing a code, one vendor | 2026-10-31 |
| `vega-devmode-enable-device/invalid-code.json` | same with a wrong code (exit 6, 3.4 s); a malformed code, an already-used code and the text mode give the same "Invalid code" | Fire TV stick showing a code | 2026-10-31 |
| `vega-devmode-enable-device/not-signed-in.json` | same while signed out (exit 2, at once) | — | 2026-10-31 |
