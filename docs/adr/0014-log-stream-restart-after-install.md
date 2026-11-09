# 0014. Restart the log stream after every install

- Status: Accepted
- Date: 2026-10-14

## Context

A `loggingctl` session only sees apps that were installed before it started. After a reinstall, the log viewer goes silent for the app being debugged, which is the most common "my logs are empty" problem. Release builds also send no `console.log` output to the stream, which looks the same.

## Decision

- Core restarts the log stream automatically after every install it performs. The desktop has a "Restart session after install" toggle, on by default.
- The stream reconnects when a device drops, with an inline note.
- Each restart is written to the activity log and shown as an OVD line in the log viewer (ADR 0011).
- When the followed app is a Release build, the viewer says its JS logs are hidden instead of looking empty.

## Consequences

- Logs keep arriving across any number of reinstalls made through OVD.
- Installs made outside OVD (directly with the SDK) don't trigger a restart.
- A short gap in the stream around each restart is expected.

## Amendments

- 2026-11-08 (#92, `0c4e284`): a stick check (ARCHITECTURE §8, `fixtures/0.24/loggingctl-log/`) showed that the Context's last sentence and the last Decision bullet are wrong: Release builds do send `console.log`, `info`, `warn` and `error` to the stream, so the viewer won't say a Release build's JS logs are hidden, and the Release-build banner is no longer planned. Also seen on the stick: Debug builds send each line twice; `console.debug` never shows up, and neither does anything logged before `AppRegistry.registerComponent`; a bundler config such as Babel `transform-remove-console` may still strip logs. #92 first rewrote the text above in place; it was restored on 2026-11-09.
