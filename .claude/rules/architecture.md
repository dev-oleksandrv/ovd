---
paths:
  - "packages/**"
  - "apps/**"
---

# Architecture rules

## Layers

- `packages/core/` owns all behavior: SDK discovery, process running, output parsing, device/package/app/log logic, target selection, the activity log.
- `apps/cli`, `apps/gui`, `apps/mcp` are surfaces. They parse input, call core, and render output. No SDK calls, no parsing of SDK output, no business rules in a surface.
- Dependencies flow `apps/* → packages/core`. Core never imports from `apps/`. Surfaces never import each other.
- Core's public API is its package entry (`packages/core/src/index.ts`). Surfaces import `@ovd/core`, never deep paths.

## Core

- Every SDK call goes through one runner (`execa`-based) that injects the target serial (`-s` / `VEGA_SERIAL`), applies timeouts, honors `AbortSignal`, and returns stdout, stderr and exit code. Tests replace the runner with a fake.
- Parsed output is validated with `zod` at the adapter boundary. Adapters are versioned per SDK version when output differs (ADR 0007).
- Long-running streams (logs, input console, memory polling) are managed child processes with explicit start/stop, auto-reconnect when a device drops, and clean shutdown on abort. No orphaned processes.
- Every device action (install, launch, stop, input, screenshot, reboot…) appends one entry to the activity log (ADR 0011).
- Core returns typed data and typed errors (an error code plus a fix hint), never preformatted human text. Formatting belongs to the surface.
- Core never reads `process.argv`, never writes to stdout/stderr, never calls `process.exit`.

## Rules

- Never shell out to `ovd` from the desktop or MCP. Call core in-process (ADR 0001).
- Never talk device protocols directly (no raw sockets to VDA, no reimplemented emulator console) except where an ADR allows it, e.g. emulator gRPC for the Virtual Device (ADR 0010).
- Never bundle, copy or download SDK binaries. Discover the user's install (`~/vega`, `vega sdk list-installed`) and fail with a fix hint when it's missing (ADR 0002).
- Commands shown to the user are the commands core actually runs.
- Don't model data the SDK can't provide (uptime, storage, a "Developer Mode off" device, Home on the Virtual Device).
- No new runtime dependency without asking.
- Structural changes (new package, new surface, new backend, new persisted store, a new SDK tool dependency) need an ADR in `docs/adr/`.
