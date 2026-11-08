# 0014. Restart the log stream after every install

- Status: Accepted
- Date: 2026-10-14

## Context

A `loggingctl` session only sees apps that were installed before it started. After a reinstall, the log viewer goes silent for the app being debugged, which is the most common "my logs are empty" problem. Logs an app never sends to the stream look the same (see Decision).

## Decision

- Core restarts the log stream automatically after every install it performs. The desktop has a "Restart session after install" toggle, on by default.
- The stream reconnects when a device drops, with an inline note.
- Each restart is written to the activity log and shown as an OVD line in the log viewer (ADR 0011).
- What reaches the stream, as seen on a stick (ARCHITECTURE §8, `fixtures/0.24/loggingctl-log/`):
  - A Release build still sends its `console.log`, `info`, `warn` and `error` lines; a Debug build sends each one twice.
  - `console.debug` never reaches the stream.
  - No `console` call made before `AppRegistry.registerComponent` reaches the stream.
  - A build that strips its `console` calls (for example with `transform-remove-console`) has none left to send.

## Consequences

- Logs keep arriving across any number of reinstalls made through OVD.
- Installs made outside OVD (directly with the SDK) don't trigger a restart.
- A short gap in the stream around each restart is expected.

## Amendments

- 2026-11-08: Amended 2026-11-08. A stick check showed that a Release build still sends its `console.log`, `info`, `warn` and `error` lines, so the claim that a Release build hides its JS logs was wrong: the last sentence of Context and the last Decision bullet were edited in place to say what reaches the stream (ARCHITECTURE §8).
