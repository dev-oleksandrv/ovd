---
'@ovd/core': minor
'@ovd/cli': minor
'@ovd/gui': minor
---

See the apps on a device: `ovd apps [--running] [--all]` lists the side-loaded and Appstore apps on the target with their version and running state (system apps with `--all`), and `ovd apps info [app]` shows one app with its components, by package or component ID, .vpkg or project folder. `ovd apps install` is the new name of `ovd install`, which stays as an alias. The desktop app gets the Apps screen (Installed and Running tabs, app detail with components) and a Running now card on each device.
