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
