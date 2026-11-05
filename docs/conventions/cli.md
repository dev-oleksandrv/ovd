---
paths:
  - 'apps/cli/**'
---

# CLI rules

- Commands are thin: parse options, call `@ovd/core`, render. No SDK calls or parsing here.
- Every command supports `--json` (ADR 0006):
  - stdout carries exactly one JSON document (or JSON lines for streams such as `ovd logs --json`). Nothing else goes to stdout in JSON mode.
  - Human-facing progress, warnings and hints go to stderr.
  - The JSON shape is a public contract. Adding a field is fine; renaming or removing one is a breaking change (`!` + `BREAKING CHANGE:`).
  - Errors in JSON mode: `{"ok": false, "error": {"code": "...", "message": "...", "hint": "..."}}` with a non-zero exit.
- Human output is the default: short, aligned, colored only when stdout is a TTY and `NO_COLOR` is unset.
- Exit codes are meaningful and documented in `docs/ARCHITECTURE.md`: `0` success, `1` failure, `2` usage error, plus the specific codes listed there (e.g. architecture mismatch, launch not verified, no SDK). Don't invent a new code without adding it there.
- Respect `VEGA_SERIAL` and the remembered target; `--device <id>` overrides both.
- Destructive or overriding actions need an explicit flag (`--force`), never a prompt in non-interactive mode.
- Streams (`logs`, `run`, `--watch`) stop cleanly on Ctrl+C: abort core, wait for child processes to exit, then exit `0`.
- Command names and flags match what the desktop echoes. If you add or rename a command, update the desktop CLI echo in the same branch.
