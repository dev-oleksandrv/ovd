---
'@ovd/core': minor
'@ovd/cli': minor
'@ovd/gui': minor
---

Install a .vpkg behind the architecture guard: `ovd install [file]` compares the package's architecture with the target's before installing, blocks a mismatch with an error naming both and the matching recent build (exit 6), and installs anyway with `--force`. The desktop app's Install on target shows the mismatch block with a one-click switch to the matching build.
