# 0013. macOS and Ubuntu only

- Status: Accepted
- Date: 2026-10-15

## Context

The Vega SDK supports only macOS and Ubuntu; Windows and WSL are not supported. GitHub's arm64 macOS runners don't support nested virtualization, so the Virtual Device can't start there. GitHub's Linux runners support hardware acceleration for emulators, and the SDK installs in CI with `NONINTERACTIVE=true` and a pinned `VEGA_SDK_VERSION`.

## Decision

- OVD supports macOS and Ubuntu only. No Windows or WSL builds, code paths or CI.
- CI runs on `ubuntu-latest` (x86_64). Device-backed CI jobs and the GitHub Action use the Virtual Device with an x86_64 build there.
- macOS is supported for local use.

## Consequences

- No Windows users at launch. The README states the supported platforms.
- Path handling and process code only need POSIX behavior.
- macOS-specific behavior (Apple Silicon Virtual Device, `aarch64`) is covered by fixtures and manual checks, not CI.
