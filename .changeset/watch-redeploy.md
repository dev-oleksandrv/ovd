---
'@ovd/cli': minor
'@ovd/gui': minor
---

- `ovd run --watch` redeploys every new build: it watches the project's `build/` folder, runs once, then reinstalls and relaunches the build that fits the target each time `react-native build-vega` writes a new one, while the log keeps following. Each run prints its result (with `--json`, one `{"ok": …}` line per run), a failed redeploy doesn't stop it, and Ctrl+C ends it. A .vpkg or a package ID is refused: watching needs a project folder.
- Logs show "Build folder changed: build/aarch64-debug/player_aarch64.vpkg" as an OVD line when a watched build folder gets a new build.
- Desktop: the title bar has a Watch toggle next to Run ▸ when a project folder is open ("Watch off" / "Watching build/"). A new build reinstalls and relaunches the app with Run's steps and a toast. It says why it can't be turned on (no target, the target offline), and turns off when another project is opened. The status bar shows the matching `ovd run --watch --device <id>` command.
