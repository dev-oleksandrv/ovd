---
paths:
  - 'packages/core/**'
  - 'fixtures/**'
---

# Vega SDK integration rules

## Calling tools

- Host tools: `vega`, `vpt`, `perf`. VDA always as `vega exec vda …`, never from PATH.
- Device tools (`vpm`, `vlcm`, `vmsgr`, `loggingctl`, `inputd-cli`, `gwsi-tool-screenshooter`, `ace_memusage`) run through `vega exec vda shell` (or `shell -c <component>` when scoped to a component).
- Target one device per call with `-s <id>` / `VEGA_SERIAL`. Over Wi‑Fi the device ID is `IP:port`; `vda get-serialno` returns the real serial.
- Use JSON modes wherever they exist: `vega device info --json`, `vpt info --json`, `loggingctl vault --json-dump`, `vega sdk … --json`. Parse text only when there is no JSON mode, and keep that parser small.
- Never request elevated access. Crash and log access is scoped to the user's own app; surface permission errors with a clear hint.

## Known SDK behavior (design around it)

- `vega device launch-app` reports success for an app that crashed. Confirm every launch with `running-apps` and crash history (ADR 0012).
- A `loggingctl` session only sees apps installed before it started. Restart the stream after every install OVD makes (ADR 0014).
- Release builds send no `console.log` to the log stream. Say so instead of showing an empty log.
- `vega device info` reports no uptime or storage. `vlcm` lifespan is a state (`ACTIVE`, `PAUSED`), not a duration.
- `inputd-cli` key presses report success but don't reach apps on the Virtual Device; use emulator gRPC `sendKey` there (OK = `kpenter`, Back = `KEY_BACK`, Home can't be sent). `gwsi-tool-screenshooter` fails on the Virtual Device; use gRPC `getScreenshot` (ADR 0010).
- The emulator gRPC endpoint is off after every Virtual Device start; enable it through the console (`grpc <port>`) with the token from `~/.emulator_console_auth_token`. Never log the token.
- Metro runs on the host; its output isn't part of the device log stream.
- The KPI Visualizer fails warm starts on the Virtual Device and fails offline apps; report both as warnings.

## Architectures

- Read the target's architecture from `vega device info`. Read the package's from `vpt info`. Compare them before every install; block on mismatch unless `--force` (ADR 0008).
- Sticks are `armv7`. The Virtual Device matches the host: `x86_64` (Intel, Ubuntu) or `aarch64` (Apple Silicon). Never hard-code a device type to an architecture.

## Developer Mode

- A stick without Developer Mode doesn't appear in `vega device list` or `vda devices`. Never model it as a device state; explain it in doctor and offer the setup flow (ADR 0009).
- Setup wraps `vega devmode login` (browser sign-in) and `vega devmode enable-device --code <6-digit code>`. The Virtual Device uses `vsm developer-mode enable`. OVD never stores credentials.

## Doctor

- Doctor only reports; it never changes the machine.
- Checks: Vega SDK (`vega --version`, `vega sdk config doctor`), VDA (`vega exec vda version`), devices (`vega device list`), Developer Mode hints, Metro ports 8081/8097. Later stages add Project and Emulator gRPC rows.
- Every failed check carries a one-line fix hint.
