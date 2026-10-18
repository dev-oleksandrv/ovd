# 0011. Activity log written by the core

- Status: Accepted
- Date: 2026-10-14

## Context

Each surface runs its own core instance (ADR 0001). The MCP server is a separate process started by the agent client, so the desktop app can't observe it directly. The Logs screen also needs to show OVD's own actions (install, log session restarted, launch verified, crash detected, build folder changed) inline with device log lines.

## Decision

- Core appends every device action (install, launch, stop, input, screenshot, reboot, and so on) to a local, append-only activity log on the host.
- Each entry records the time, the surface (CLI, desktop, MCP, Action), the action, the target, its arguments and the result.
- The desktop's Logs timeline and its "Recent agent calls" list read from the activity log.
- Entries never contain secrets, tokens or credentials.

## Consequences

- The desktop can show what an agent or a CLI session did without coordinating processes.
- OVD events in the log viewer are clearly marked as OVD lines, not device log lines.
- The log needs rotation or a size cap, and safe concurrent appends from several processes.
