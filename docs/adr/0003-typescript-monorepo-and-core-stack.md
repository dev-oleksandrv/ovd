# 0003. TypeScript monorepo and core stack

- Status: Accepted
- Date: 2026-10-14

## Context

The people most likely to contribute are Vega app developers, who write React Native and TypeScript. The core spawns many short-lived and long-running SDK processes and parses their output, which is the project's main risk. The CLI must be scriptable from day one.

## Decision

- TypeScript everywhere, `strict`, ES modules, on Node.js 22 or later (`.nvmrc` pins the development version).
- A pnpm workspace: `packages/*` for libraries (`packages/core`), `apps/*` for surfaces (`apps/cli`, `apps/gui`, later `apps/mcp`).
- Core: `execa` for child processes, `zod` to validate parsed output.
- CLI: `commander`, bundled with `tsup`.
- Tests: Vitest in every package, with recorded SDK outputs as fixtures (ADR 0007).
- One lint and format configuration for the whole workspace.
- A terminal UI (`ink`) is optional and late, for SSH and headless use.

## Consequences

- Contributors need only Node and pnpm, plus the Vega SDK for manual device checks.
- The same types flow from core into the CLI, the desktop and the MCP server.
- Rust would be faster and give smaller binaries; it was rejected because it would shrink the contributor pool.
