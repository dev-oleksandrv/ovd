---
paths:
  - 'packages/**'
  - 'apps/**'
  - 'fixtures/**'
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

## Style

- CLI tests assert the `--json` document and exit code, not human formatting details.
- Desktop: test renderer logic and state with React Testing Library; query by role/text the user sees. Visual checks and real-device flows are manual.
- No snapshot tests.
- Prefer table tests (`test.each`) for parsers, mappings and architecture comparisons; include edge cases (empty list, offline device, unknown architecture).
- Run `pnpm run check` before committing.
