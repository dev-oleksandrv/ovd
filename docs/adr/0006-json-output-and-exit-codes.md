# 0006. JSON output and exit codes

- Status: Accepted
- Date: 2026-10-14

## Context

The SDK tools print raw text that is hard to script. OVD is meant to be used from CI, from scripts and by AI agents as much as by people. Those consumers need machine-readable output that doesn't change underneath them, and a reliable success or failure signal.

## Decision

- Every command accepts `--json`. Human-readable output is the default.
- In JSON mode, stdout carries exactly one JSON document, or JSON lines for streaming commands. Progress, warnings and hints go to stderr.
- Errors in JSON mode use one shape: `{"ok": false, "error": {"code", "message", "hint"}}`.
- Exit codes are meaningful: `0` success, `1` generic failure, `2` usage error, plus specific codes for well-known failures (no SDK, architecture mismatch, launch not verified, target offline). The list lives in `docs/ARCHITECTURE.md`.
- The JSON shape is a public contract. Adding fields is compatible; renaming or removing fields is a breaking change.

## Consequences

- Scripts, CI and agents can rely on OVD without parsing human text.
- Output types need care: core returns typed data, and the CLI serializes it the same way every time.
- The MCP server and the GitHub Action can reuse the same shapes.
