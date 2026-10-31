# 0023. End-to-end tests against a fake SDK

- Status: Accepted
- Date: 2026-10-31

## Context

Unit tests cover parsers against fixtures, core actions with a fake runner, CLI commands in-process and renderer components in jsdom. Nothing runs what ships: the bundled `ovd` binary, SDK discovery on a real file system, the host state shared between invocations, or the Electron main process, preload and renderer together. Breaks between those parts only show up in manual device checks. Real hardware and the real SDK can't run on every PR (ADR 0007 keeps tests hardware-free), so the end-to-end layer needs a stand-in for the SDK that still behaves like it.

## Decision

- A private workspace package `e2e/` (`@ovd/e2e`) holds the end-to-end tests. It depends on no surface's code: it runs the built CLI (`apps/cli/dist`) and, from Stage 1's desktop pass on, the built desktop app (`apps/gui/out`) through Playwright's Electron support.
- **Fake SDK.** `e2e/fake-sdk/` is an executable `vega` that answers every command core runs with a recorded output from `fixtures/<sdk-version>/` and its recorded exit code. It never makes up output. Where real output is one line per device (`vda devices -l`), it is assembled from recorded lines. It keeps a small world state (sticks, the Virtual Device, sign-in, VDA connections) so commands have their real effects: `vega virtual-device start` makes the Virtual Device listed, `vda tcpip` takes the stick off USB.
- The fake SDK is installed where the SDK Manager puts the Vega CLI (`~/vega/bin/vega`) in a temporary home, so SDK discovery runs unchanged. `OVD_HOME` points into the same sandbox. Nothing from the real machine is used.
- A command with no recording fails, and the test fails with it. Every test can assert the exact SDK commands a flow ran, which also checks that commands shown to users are real.
- E2E tests check flows: a user action and its visible outcome, plus the SDK calls and state it leaves. No "it renders" or "it exits 0" tests, no snapshots.
- `pnpm run test:e2e` builds what it tests and runs the suite. It stays out of `pnpm test`. CI runs it as the required `e2e` job on Ubuntu for every PR, and on macOS for every push to `main` (ADR 0013).
- Every stage adds e2e tests for its flows, in both surfaces, and a stage isn't done until they pass (`docs/ROADMAP.md`).

## Consequences

- The binary users install and the app they open are tested on every PR, without hardware.
- A new SDK command needs a recorded fixture before its flow can be e2e-tested; the fake SDK learns it from that fixture.
- The fake SDK models timing loosely: a stick reboots in one poll, not 41 s. Flows that depend on real timing, and SDK behavior itself, stay with the hardware checks and the nightly SDK check (Stage 3.7).
- E2E runs are slower than unit tests (seconds per flow), so they run as their own CI job.
