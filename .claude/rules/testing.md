---
paths:
  - 'packages/**'
  - 'apps/**'
  - 'fixtures/**'
  - 'e2e/**'
---

# Testing rules

- Vitest across the workspace. Tests sit next to the package they test: `packages/core/src/devices/parseDeviceInfo.ts` → `packages/core/test/devices/parseDeviceInfo.test.ts` (mirror `src/` 1:1).
- Write the failing test first for parsers, core actions, CLI JSON output, and bug fixes.
- **No hardware in tests.** No real SDK calls, devices, network or timers. Core tests use a fake runner that replays fixtures; streams use fake child processes; time uses fake timers.
- Parsers are tested against recorded outputs in `fixtures/<sdk-version>/<tool>/<case>.<ext>` (e.g. `fixtures/0.24/vega-device-info/stick-usb.json`). When the SDK changes output, add a new version folder; keep the old one while the old adapter is supported.

## Recording a fixture

1. Run the exact command core runs, against a real device or the Virtual Device, and save raw stdout (and stderr/exit code when the parser uses them).
2. Sanitize before saving: replace serials with fake ones, IPs with documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`), hostnames and account emails with placeholders, app IDs with the `com.example.*` sample set, device names with the sample names.
3. Note the SDK version, device type and command in a sibling `README.md` or the test name.
4. Never edit a fixture's structure by hand to make a test pass. Re-record instead.

## End-to-end tests

- `e2e/` runs what ships: the built CLI (`apps/cli/dist`) and desktop app, in a sandbox with a temporary home, `OVD_HOME` and the fake SDK installed at `~/vega/bin/vega` (ADR 0023). `pnpm run test:e2e` builds first.
- The fake SDK (`e2e/fake-sdk/`) answers only with recorded fixtures and their recorded exit codes. A new SDK command: record its fixture first, then add its answer and its effect on the world. Never write SDK output by hand; an unrecorded command fails the test.
- Test a flow, not a screen or a command in isolation: set up the world, do what the user does, then assert the outcome they see, the SDK commands run (`sandbox.calls()`) and the state left (`hostState()`, `activity()`, `world()`).
- Not e2e tests: "renders", "exits 0", or assertions that hold whether the feature works or not. Each test must fail if the flow breaks.
- Cover the error states a flow promises (wrong code, refused port, offline device) as well as the happy path.
- One sandbox per test, so tests run in parallel and never share state.
- CLI flows: Vitest in `e2e/cli/`, through `ovd()` from `harness/cli.ts`. Desktop flows: Playwright in `e2e/gui/`, through the `sandbox` and `launch` fixtures from `harness/gui.ts`; query by role and visible text, and assert the toast and status-bar CLI echo of each action.
- Wait for what the user would see (`expect(...)` retries), never for fixed time. When the app does background work that can race the flow (the doctor run at launch), wait for its last SDK call and say why in a comment.

## Style

- CLI tests assert the `--json` document and exit code, not human formatting details.
- Desktop: test renderer logic and state with React Testing Library; query by role/text the user sees. Whole desktop flows are e2e tests (`e2e/gui/`); visual checks and real-device flows are manual.
- No snapshot tests.
- Prefer table tests (`test.each`) for parsers, mappings and architecture comparisons; include edge cases (empty list, offline device, unknown architecture).
- Run `pnpm run check` before committing.
