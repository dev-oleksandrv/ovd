# 0017. MCP server: stdio and device control only

- Status: Accepted
- Date: 2026-10-14

## Context

AI coding agents (Claude Code, Cursor, Kiro) need to install, launch, read logs and look at the screen. Amazon's Builder Tools MCP server already covers Vega docs search, trace analysis, hot functions and crash symbolication, but not device control. MCP servers can't call each other; the agent combines them. A stdio MCP server is started by the agent client, so no other app can switch it on or off.

## Decision

- `ovd mcp` runs an MCP server over stdio, built on `@modelcontextprotocol/sdk`, as a thin layer over core (`apps/mcp`).
- Tools cover device control only: devices, install (architecture-checked), launch (verified), terminate, logs tail, key press, type text, screenshot (returns a path), crashes (returns crash report paths), shell.
- No docs search or trace analysis. File paths are returned so the agent can hand them to Amazon's tools.
- The desktop app has no on/off switch. It offers "Add to Claude Code / Cursor / Kiro" configuration helpers and shows recent agent calls from the activity log (ADR 0011).

## Consequences

- OVD complements Amazon's tooling instead of competing with it; docs show both servers configured side by side.
- The desktop can't tell whether the MCP server is running, only what it did.
- Every MCP tool reuses the same core action and JSON shape as its CLI command.
