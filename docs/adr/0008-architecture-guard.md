# 0008. Architecture guard against the target's reported architecture

- Status: Accepted
- Date: 2026-10-15

## Context

Vega targets use different CPU architectures. Fire TV sticks (Fire TV Stick 4K Select) are `armv7`. The Virtual Device matches the host: `x86_64` on Intel Macs and Ubuntu, `aarch64` on Apple Silicon. Installing a package of the wrong architecture fails with confusing errors and costs a debugging session.

## Decision

- Before every install (Packages, Apps, Run, CLI), compare the package's architecture with the architecture the target reports (`vega device info`). Never infer the architecture from the device type.
- The package's architecture is the `lib/<arch>/` folder in `vpt show-contents`: `vpt info --json` doesn't report one (vpt 1.2.29, SDK 0.24). A package without `lib/` is pure JS: its packages for each architecture differ only in their signatures, so it is `any` and passes the guard. Several or unrecognized `lib/` folders are `unknown` and block like a mismatch.
- On mismatch, block the install with an error that names both architectures. The CLI offers `--force` to override. The desktop offers a one-click switch to a matching build from the recent builds when one exists.
- The run loop picks the build that matches the target: release for sticks, host-architecture debug for the Virtual Device.

## Consequences

- Wrong-architecture installs stop being a source of confusion.
- Every install path needs the target's device info first, which costs one SDK call per install.
- Sample data and fixtures must never show an `aarch64` stick.
- Reading a package's architecture costs a second `vpt` call (`show-contents`).

## Amendments

- 2026-11-01 (Stage 2.2): recorded with SDK 0.24.12112, `vpt info --json` names no architecture; the architecture comes from `vpt show-contents`, and pure-JS packages are `any`.
- 2026-11-01 (Stage 2.3): recorded on the Virtual Device, `vega device install-app` installs a package whose native code is for another architecture without complaint (exit 0, `…success`), so the guard is the only check. A blocked install exits 6.
