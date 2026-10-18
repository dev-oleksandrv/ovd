# Architecture Decision Records

An ADR records one significant decision: the context, what was decided, and what follows from it.

## Rules

- One decision per file, named `NNNN-kebab-title.md` with the next free number.
- Once accepted, an ADR is not edited, except to update its status.
- To change a decision, write a new ADR. It links to the old one, and the old one's status becomes "Superseded by NNNN".
- Write an ADR when you add a package or a surface, depend on a new SDK tool, add a backend (screen, input, device type), add a persisted store, or change how parts fit together.

## Template

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences
```

## Index

- [0001 One core, thin surfaces](0001-one-core-thin-surfaces.md)
- [0002 Wrap the official Vega SDK tools](0002-wrap-official-sdk-tools.md)
- [0003 TypeScript monorepo and core stack](0003-typescript-monorepo-and-core-stack.md)
- [0004 Electron for the desktop app](0004-electron-desktop-app.md)
- [0005 CLI and desktop ship together](0005-cli-and-desktop-ship-together.md)
- [0006 JSON output and exit codes](0006-json-output-and-exit-codes.md)
- [0007 Versioned SDK output adapters and recorded fixtures](0007-sdk-output-adapters-and-fixtures.md)
- [0008 Architecture guard against the target's reported architecture](0008-architecture-guard.md)
- [0009 Developer Mode is a setup flow, not a device state](0009-developer-mode-setup-flow.md)
- [0010 Two backends for screen and input](0010-screen-and-input-backends.md)
- [0011 Activity log written by the core](0011-activity-log.md)
- [0012 Verified launches](0012-verified-launches.md)
- [0013 macOS and Ubuntu only](0013-macos-and-ubuntu-only.md)
- [0014 Restart the log stream after every install](0014-log-stream-restart-after-install.md)
- [0015 Licensing, distribution and no telemetry](0015-licensing-distribution-telemetry.md)
- [0016 Neutral sample data](0016-neutral-sample-data.md)
- [0017 MCP server: stdio and device control only](0017-mcp-server-scope.md)
- [0018 Stage-by-stage releases and a growing UI](0018-stage-releases-growing-ui.md)
- [0019 The desktop design is the spec](0019-desktop-design-is-the-spec.md)
- [0020 Changesets and tag-driven releases](0020-changesets-and-tag-releases.md)
