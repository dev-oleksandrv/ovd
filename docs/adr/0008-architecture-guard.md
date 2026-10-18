# 0008. Architecture guard against the target's reported architecture

- Status: Accepted
- Date: 2026-10-15

## Context

Vega targets use different CPU architectures. Fire TV sticks (Fire TV Stick 4K Select) are `armv7`. The Virtual Device matches the host: `x86_64` on Intel Macs and Ubuntu, `aarch64` on Apple Silicon. Installing a package of the wrong architecture fails with confusing errors and costs a debugging session.

## Decision

- Before every install (Packages, Apps, Run, CLI), compare the package's architecture (`vpt info`) with the architecture the target reports (`vega device info`). Never infer the architecture from the device type.
- On mismatch, block the install with an error that names both architectures. The CLI offers `--force` to override. The desktop offers a one-click switch to a matching build from the recent builds when one exists.
- The run loop picks the build that matches the target: release for sticks, host-architecture debug for the Virtual Device.

## Consequences

- Wrong-architecture installs stop being a source of confusion.
- Every install path needs the target's device info first, which costs one SDK call per install.
- Sample data and fixtures must never show an `aarch64` stick.
