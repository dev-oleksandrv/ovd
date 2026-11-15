# 0028. End-to-end tests against a fake SDK, with open stick checks

- Status: Superseded by 0030
- Date: 2026-11-15

Decided by the maintainer at the Stage 4 sign-off on 2026-11-12 (#119) and first written as an amendment to ADR 0023. Moved into this ADR on 2026-11-15 (#121, #124), because a changed decision gets a new ADR (`docs/adr/README.md`).

## Context

ADR 0023 set up the e2e layer: the built CLI and desktop app run against a fake SDK that answers only with recorded fixtures and "never makes up output". Stage 4 added stick paths (input, screenshots, reboot) before a stick was available to record them. Their `[HW]` checks stayed open, so under ADR 0023 those flows could not be covered end to end until the hardware check ran. The maintainer allowed one narrow exception so they are covered now. This ADR supersedes 0023. It keeps 0023's other decisions unchanged.

## Decision

- A private workspace package `e2e/` (`@ovd/e2e`) holds the end-to-end tests. It depends on no surface's code: it runs the built CLI (`apps/cli/dist`) and the built desktop app (`apps/gui/out`) through Playwright's Electron support.
- **Fake SDK.** `e2e/fake-sdk/` is an executable `vega` that answers every command core runs with a recorded output from `fixtures/<sdk-version>/` and its recorded exit code. It never makes up output, except as below. Where real output is one line per device (`vda devices -l`), it is assembled from recorded lines. It keeps a small world state (sticks, the Virtual Device, sign-in, VDA connections) so commands have their real effects: `vega virtual-device start` makes the Virtual Device listed, `vda tcpip` takes the stick off USB.
- **Open stick checks.** A stick path whose `[HW]` hardware check is still open may be answered with hand-written output, or with another device's recording, so its flow is covered before a stick is available. Each such answer:
  - is listed in `fixtures/<sdk-version>/README.md` under "Synthesized sequences", which is the one place that says which answers are synthesized today;
  - is marked as synthesized in the fake SDK's source;
  - names its `[HW]` issue;
  - is replaced by a recording when that check runs, and the README entry goes with it.
- The fake SDK is installed where the SDK Manager puts the Vega CLI (`~/vega/bin/vega`) in a temporary home, so SDK discovery runs unchanged. `OVD_HOME` points into the same sandbox. Nothing from the real machine is used.
- A command with no recording, and no synthesized answer under the rule above, fails, and the test fails with it. Every test can assert the exact SDK commands a flow ran, which also checks that commands shown to users are real.
- E2E tests check flows: a user action and its visible outcome, plus the SDK calls and state it leaves. No "it renders" or "it exits 0" tests, no snapshots.
- `pnpm run test:e2e` builds what it tests and runs the suite. It stays out of `pnpm test`. CI runs it as the required `e2e` job on Ubuntu for every PR, and on macOS for every push to `main` (ADR 0013).
- Every stage adds e2e tests for its flows, in both surfaces, and a stage isn't done until they pass (`docs/ROADMAP.md`).

## Consequences

- The binary users install and the app they open are tested on every PR, without hardware.
- A new SDK command needs a recorded fixture before its flow can be e2e-tested; the fake SDK learns it from that fixture. The only way around it is an open `[HW]` check on a stick path.
- A synthesized answer can be wrong. A flow that passes against one proves OVD handles what the stick is expected to print, not what it prints; the `[HW]` issue stays open until the recording replaces it.
- The fake SDK models timing loosely: a stick reboots in one poll, not 41 s. Flows that depend on real timing, and SDK behavior itself, stay with the hardware checks and the nightly SDK check (Stage 3.7).
- E2E runs are slower than unit tests (seconds per flow), so they run as their own CI job.
