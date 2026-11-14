---
'@ovd/cli': minor
---

- `ovd logs` filters more: `--pid`, `--tid`, `--tag`, `--identity`, `--facility` and `--boot <id|current>` (each repeatable), and shows only the lines of one boot. A search pattern that could backtrack badly is refused.
- `ovd logs --preset <name>` starts from `all`, `app-errors` (errors of your own apps), `network`, `lifecycle` or a filter you saved; flags you add override it. `ovd logs filter save <name>`, `ovd logs filter list` and `ovd logs filter rm <name>` manage saved filters.
- `--process-level <identity>=<level>`, `--process-rate <identity>=<n>` and `--mute <identity>` quiet a noisy process in what OVD shows, without changing the device.
- `ovd logs bundle` saves a `.zip` for a bug report with the filtered log, the apps and the crash list, to `~/ovd/bundles` (or `--out`; `--duration <s>` adds live seconds).
- The Logs screen of the desktop app gets presets, saved filters, advanced filters, per-process Mute, Level and Limit, and Bundle next to Export. "Logs at crash time" now filters by the crashed process.
