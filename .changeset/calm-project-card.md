---
'@ovd/core': minor
'@ovd/cli': minor
'@ovd/gui': minor
---

Project mode and no-project mode: `ovd open <folder>` opens a Vega project (a folder with `manifest.toml` and `package.json`) and `ovd open <file.vpkg>` installs from a package without one; `ovd project` shows which, and `ovd close` forgets it. `ovd doctor` gains a Project row that runs `vega project doctor` in the project folder. The desktop adds the sidebar project card (folder, path, OS and React Native versions, or "No project" with the loaded .vpkg), drag-and-drop of a .vpkg anywhere in the window, and the Doctor Project row with "Open folder…" and Details listing every check, its fix hints, Copy output and Re-run. A subcommand missing an argument now exits 2.
