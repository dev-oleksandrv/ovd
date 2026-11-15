---
'@ovd/cli': minor
---

- `ovd pkg validate [file]` checks a .vpkg with `vpt validate` and lists each problem with its severity, message and line in `manifest.toml`. It exits 1 (`PACKAGE_INVALID`) when the package has errors, so scripts and CI can gate on it.
- `ovd pkg manifest [file]` prints the package's `manifest.toml` with line numbers and the validation notes under their lines. `ovd pkg files [file]` lists the files in the package as a tree.
- The Packages screen of the desktop app gets the Manifest, Files and Validate tabs. Validate shows an error badge, and a click on a line opens it in Manifest.
