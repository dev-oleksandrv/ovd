---
'@ovd/cli': minor
---

- The desktop app tells you when one of your apps crashes: a toast within seconds, a badge on the new Crashes screen, and a list of crashes with their stack. From a crash you can download the whole report, copy its path, copy a prompt for your AI agent, or jump to the logs at the time of the crash. Only apps you installed yourself are shown.
- `ovd crashes` lists the crash reports of your apps on the target, and `ovd crashes --watch` prints new ones as they happen. `ovd crash pull <id>` saves a report to `~/ovd/crashes` (or `--out <file or folder>`, `--force` to replace a file).
- `ovd screenshot --out` into a symbolic link to a folder now saves into the real folder, and a symbolic link as the target file is refused, with or without `--force`.
