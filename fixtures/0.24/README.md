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
