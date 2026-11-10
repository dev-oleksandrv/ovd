---
'@ovd/cli': minor
'@ovd/gui': minor
---

- `ovd run` deploys in one step: it picks the build that matches the target (a Debug build on the Virtual Device, a Release build on a stick), installs it, starts the log, launches the app, checks that it really runs, then follows its log until Ctrl+C. With `--json` the first line is the run's result, then the `ovd logs --json` lines. It exits 7 when the app crashes on launch, with the crash's cause.
- Desktop: the title bar has a Run ▸ button for the open project or .vpkg. It shows each step as it goes, opens Logs once the app runs, and says why when it can't run (nothing open, no target, the target offline). The status bar shows the matching `ovd run --device <id>` command.
