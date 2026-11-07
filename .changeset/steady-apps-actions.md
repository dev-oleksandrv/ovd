---
'@ovd/core': minor
'@ovd/cli': minor
'@ovd/gui': minor
---

Act on the apps on a device: `ovd apps launch`, `ovd apps terminate [--force]`, `ovd apps restart`, `ovd apps uninstall` and `ovd apps reinstall [--force]` take a package or component ID, a .vpkg or a project folder (default: the open one), check that the app is installed, and log each action in the activity log. An app ID that isn't one (letters, digits, dots, hyphens and underscores), whether passed, read from a project's `manifest.toml` or from a .vpkg, is refused with `INVALID_APP_ID` (exit code 2) before any SDK command runs. `ovd apps install` and `ovd apps reinstall` now also accept a project folder, where they pick the build that matches the target, or a package ID of the open project or .vpkg. The desktop Apps screen gets Launch and Stop on each row, and Launch, Restart, Terminate, Force stop, Uninstall & reinstall and Uninstall in the app detail, each echoing its `ovd apps …` command.
