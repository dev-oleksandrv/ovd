# 0030. End-to-end tests against a fake SDK, with two kinds of synthesized answer

- Status: Accepted
- Date: 2026-11-15

Decided by the maintainer in the session of 2026-11-15 (pre-approved at the Stage 5 sign-off, #60). `docs/conventions/testing.md` already allowed the second kind of synthesized answer below (#144); this ADR writes that decision down, because a changed decision gets a new ADR (`docs/adr/README.md`).

## Context

ADR 0028 kept ADR 0023's e2e layer, a fake SDK that answers only with recorded fixtures, and allowed one exception: hand-written answers for a stick path whose `[HW]` check is still open. Some answers can't be recorded even with the hardware at hand: an error path or a log volume the SDK can't be made to print on demand, a value that must differ from the recorded one (the boot ID after a reboot), or a file whose real content can't be committed (a real screen, a real crash report with memory dumps). Without them those flows can't be covered end to end. The e2e suite already used such answers and `docs/conventions/testing.md` allowed them, while ADR 0028 listed only the open-`[HW]` exception. This ADR supersedes 0028. It keeps 0028's other decisions unchanged.

## Decision

- A private workspace package `e2e/` (`@ovd/e2e`) holds the end-to-end tests. It depends on no surface's code: it runs the built CLI (`apps/cli/dist`) and the built desktop app (`apps/gui/out`) through Playwright's Electron support.
- **Fake SDK.** `e2e/fake-sdk/` is an executable `vega` that answers every command core runs with a recorded output from `fixtures/<sdk-version>/` and its recorded exit code. It never makes up output, except as below. Where real output is one line per device (`vda devices -l`), it is assembled from recorded lines. It keeps a small world state (sticks, the Virtual Device, sign-in, VDA connections) so commands have their real effects: `vega virtual-device start` makes the Virtual Device listed, `vda tcpip` takes the stick off USB.
- **Synthesized answers.** Two kinds of answer may be written by hand instead of recorded:
  - **Open stick checks.** A stick path whose `[HW]` hardware check is still open may be answered with hand-written output, or with another device's recording, so its flow is covered before a stick is available. It names its `[HW]` issue and is replaced by a recording when that check runs.
  - **Answers no recording can give.** An error path or a log volume the SDK can't be made to print on demand, a value that must differ from the recorded one, or a file whose real content can't be committed. It keeps the recorded format and is replaced by a recording once one can be made.
- Each synthesized answer is listed in `fixtures/<sdk-version>/README.md` under "Synthesized sequences", which is the one place that says which answers are synthesized today, and is marked as synthesized in the fake SDK's source. Its README entry goes when a recording replaces it.
- Recordings put together in an order that wasn't recorded as one run are not synthesized; the fixtures README describes them under "Assembled sequences". A timing knob in the world may delay a recorded answer, but it never changes what the SDK prints.
- The fake SDK is installed where the SDK Manager puts the Vega CLI (`~/vega/bin/vega`) in a temporary home, so SDK discovery runs unchanged. `OVD_HOME` points into the same sandbox. Nothing from the real machine is used.
- A command with no recording, and no synthesized answer under the rule above, fails, and the test fails with it. Every test can assert the exact SDK commands a flow ran, which also checks that commands shown to users are real.
- E2E tests check flows: a user action and its visible outcome, plus the SDK calls and state it leaves. No "it renders" or "it exits 0" tests, no snapshots.
- `pnpm run test:e2e` builds what it tests and runs the suite. It stays out of `pnpm test`. CI runs it as the required `e2e` job on Ubuntu for every PR, and on macOS for every push to `main` (ADR 0013).
- Every stage adds e2e tests for its flows, in both surfaces, and a stage isn't done until they pass (`docs/ROADMAP.md`).

## Consequences

- The binary users install and the app they open are tested on every PR, without hardware.
- A new SDK command needs a recorded fixture before its flow can be e2e-tested; the fake SDK learns it from that fixture. The only ways around it are the two kinds of synthesized answer, each listed in the fixtures README.
- A synthesized answer can be wrong. A flow that passes against one proves OVD handles what the SDK is expected to print, not what it prints; an open `[HW]` issue stays open until the recording replaces it.
- The second kind has no hardware check to close it, so it can stay for good. Keeping the recorded format and listing each one keeps it small and visible.
- The fake SDK models timing loosely: a stick reboots in one poll, not 41 s. Flows that depend on real timing, and SDK behavior itself, stay with the hardware checks and the nightly SDK check (Stage 3.7).
- E2E runs are slower than unit tests (seconds per flow), so they run as their own CI job.
