---
'@ovd/cli': minor
'@ovd/gui': minor
---

- `ovd logs --export <file>` saves the log to a file instead of printing it, as plain text (the default) or as JSON lines with `--format jsonl`, one `ovd logs --json` line per entry. It won't replace an existing file unless you pass `--force`. When it stops it prints `Exported N lines to <file>`, or one result document with `--json`.
- Desktop Logs: Export now asks for the format, plain text or JSON lines, and the command palette has "Export logs as plain text…" and "Export logs as JSON lines…". The status bar shows the matching `ovd logs … --export` command.
