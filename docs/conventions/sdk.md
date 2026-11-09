---
paths:
  - 'packages/core/**'
  - 'fixtures/**'
---

# Vega SDK integration conventions

Applies to the `paths:` above. Claude Code loads it through the `.claude/rules/sdk.md` symlink when it touches a matching file; other agents start from `AGENTS.md`.

How core calls the Vega SDK. What the SDK actually does, quirks included, is in [ARCHITECTURE §8 Known SDK behavior](../ARCHITECTURE.md#8-known-sdk-behavior): read it before you call a tool, and record any new behavior there, not here.

## Calling tools

- Host tools: `vega`, `vpt`, `perf`. VDA always as `vega exec vda …`, `vpt` as `vega exec vpt …`, never from PATH.
- `vega sdk` and `vega devmode` only through the Vega CLI (`~/vega/bin/vega`), never the `vega` bundled inside an SDK.
- Device tools (`vpm`, `vlcm`, `vmsgr`, `loggingctl`, `inputd-cli`, `gwsi-tool-screenshooter`, `ace_memusage`) run through `vega exec vda shell` (or `shell -c <component>` when scoped to a component).
- Target one device per call: `vega device …` takes `--device <id>`; `vega exec vda` takes `-s <serial>` (the `IP:port` over Wi‑Fi).
- Judge success by what a tool reports, not by its exit code alone, wherever §8 says the exit code lies (`install-app`, `launch-app`, `vlcm terminate-app`, `vda connect`, `virtual-device start`).
- Use JSON modes wherever they exist: `vega device info` (JSON by default, no `--json` flag), `vpt info --json`, `loggingctl vault --json-dump`, `vega sdk … --json`, `vega devmode … --json`. Parse text only when there is no JSON mode, and keep that parser small.
- One SDK command at a time per core: every call goes through the serial runner.
- Never run `vega platform doctor`: it prints the whole environment, secrets included.
- Never log, echo or store the emulator console token (`~/.emulator_console_auth_token`); read it at runtime only.
- Never request elevated access. Crash and log access is scoped to the user's own app; surface permission errors with a clear hint.

## Designing around the SDK

- Confirm every install with the architecture guard and every launch with `running-apps` and crash history (ADR 0008, ADR 0012).
- Never trust `launch-app` alone: read a crash-history baseline before it, let the app settle, then read the crash history again. A new entry of the package is a crash; a listed pid 0 (`IDLE`) isn't running.
- A long-running SDK stream (`loggingctl log -f`) runs in its own process group and is stopped by signalling the group (SIGTERM, then SIGKILL after a grace period); signalling the top `vega` alone orphans the chain (ARCHITECTURE §8).
- A background device capture is always stopped in a `finally` with `pkill -P <timeout pid>` (plain `kill` orphans `loggingctl`), and runs under a `timeout` that outlives the action, so it ends even when OVD can't stop it.
- Restart the log stream after every install OVD makes (ADR 0014). A restarted stream first prints the journal backlog again, and core drops what it already delivered (ARCHITECTURE §8). Release builds send `console.log`, `info`, `warn` and `error`; Debug builds send each line twice; `console.debug` and anything logged before `AppRegistry.registerComponent` never show up, and a bundler config such as Babel `transform-remove-console` may still strip logs (ARCHITECTURE §8).
- On the Virtual Device, send keys and take screenshots through emulator gRPC, enabling it after every start (ADR 0010).
- Report KPI Visualizer failures on warm starts on the Virtual Device and on offline apps as warnings.

## Architectures

- Read the target's architecture from `vega device info`. Read the package's from `lib/<arch>/` in `vpt show-contents`; no `lib/` means pure JS, `any` (ADR 0008). Compare them before every install; block on mismatch unless `--force` (ADR 0008).
- Never hard-code a device type to an architecture.

## Developer Mode

- Never model "Developer Mode off" as a device state; explain it in doctor and offer the setup flow (ADR 0009).
- Setup wraps `vega devmode login` (browser sign-in) and `vega devmode enable-device --code <code> [--vendor <id>]`. The Virtual Device uses `vsm developer-mode enable`. OVD never stores credentials.

## Doctor

- Doctor only reports; it never changes the machine.
- Checks: Vega SDK (`vega --version` must be the Vega CLI, `vega sdk config doctor --json`), VDA (`vega exec vda version`), devices (`vega exec vda devices -l`, `vega virtual-device status`), Developer Mode sign-in (`vega devmode login --json` probe, 5 s timeout, stopped as soon as it prints `pending`), Metro ports 8081/8097 (host connect test on 127.0.0.1 and ::1, `vega device is-port-forwarded` on an online target), Node ≥ 22 (`node --version` through the user's login shell, `$SHELL -ilc`, because an app started from Finder doesn't get the shell PATH; not found is a warning), Project (`vega project doctor` run in the open project folder; info with nothing open, ok with only a .vpkg; no JSON mode, so parse the check lines). Stage 4 adds Emulator gRPC.
- Every failed check carries a one-line fix hint.
