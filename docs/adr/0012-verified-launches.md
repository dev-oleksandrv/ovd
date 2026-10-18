# 0012. Verified launches

- Status: Accepted
- Date: 2026-10-14

## Context

`vega device launch-app` reports success for an app that crashes right after launch. Developers then look at a "running" app that isn't there.

## Decision

- Never trust the launch command's success alone. After every launch, core confirms it with `running-apps` and the crash history.
- While confirming, the desktop shows "Verifying launch". A crash is reported as "Crashed on launch" with its cause and a link to logs around the crash.
- The CLI exits non-zero and reports `"verified": false, "reason": "crashed"` in JSON.

## Consequences

- Launches take slightly longer, because verification waits for the app to settle.
- Silent crashes become visible in every surface, including CI and agents.
