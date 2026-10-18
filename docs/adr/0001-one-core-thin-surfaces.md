# 0001. One core, thin surfaces

- Status: Accepted
- Date: 2026-10-14

## Context

OVD reaches users through several surfaces: a CLI, a desktop app, and later an MCP server for AI agents and a GitHub Action for CI. Each one needs the same device, package, app and log behavior. If logic lived in a surface, every feature would be built several times and the surfaces would drift apart. The project has a single maintainer, so duplicated work is the biggest threat to progress.

## Decision

- All behavior lives in `packages/core`: SDK discovery and process running, output parsing, devices, packages, apps, logs, crashes, input, target selection and the activity log.
- `apps/cli`, `apps/gui`, `apps/mcp` and the GitHub Action are thin shells. They parse input, call core and render the result.
- Dependencies flow `apps/* → packages/core` only. Surfaces import core through its package entry, never through deep paths, and never import each other.
- The desktop app and the MCP server call core in-process. They never shell out to an `ovd` binary found on PATH.
- Each surface runs its own core instance. Cross-process visibility (for example the desktop showing what an agent did) goes through the activity log (ADR 0011).

## Consequences

- A feature is built once and appears in every surface.
- Core must stay surface-agnostic: it returns typed data and typed errors, never formatted text, and never touches `process.argv`, stdout or `process.exit`.
- Core can be tested without rendering a UI or parsing CLI arguments.
- The desktop app's main process carries core and its dependencies, which grows the app bundle.
