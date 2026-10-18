# 0010. Two backends for screen and input

- Status: Accepted
- Date: 2026-10-15

## Context

On Fire TV sticks, `inputd-cli` sends keys and text, and `gwsi-tool-screenshooter` takes screenshots. On the Virtual Device neither works: `inputd-cli` reports success but keys never reach apps, and the screenshooter writes an empty file or hangs. The Virtual Device is built on the Android emulator, whose gRPC endpoint does work: `sendKey` reaches apps (OK arrives as `kpenter`, Back must be `KEY_BACK`, Home cannot be sent), and `getScreenshot` reaches 16–57 frames per second. The gRPC endpoint is off after every start and is switched on through the emulator console, authenticated with `~/.emulator_console_auth_token`. The community project vega-vvd-driver (MIT, TypeScript) already implements this.

## Decision

- Screen and input sit behind one core interface with two backends:
  - Sticks: `inputd-cli` (one persistent console session for low latency) and `gwsi-tool-screenshooter` plus `pull`.
  - Virtual Device: emulator gRPC (`sendKey`, `getScreenshot`), enabled through the console on every Virtual Device start.
- Prefer depending on or contributing to vega-vvd-driver for the Virtual Device backend over rebuilding it.
- Home is disabled on the Virtual Device with an explanation.
- Live view ships for the Virtual Device. Sticks show the latest screenshot with Refresh until their screenshot rate is measured on hardware.
- The console auth token is read at runtime and never logged.

## Consequences

- Two code paths to maintain and test.
- Doctor gets an "Emulator gRPC" row.
- This is the one place OVD talks to an endpoint directly instead of through an SDK tool, and only because the SDK tools don't work there (ADR 0002).
