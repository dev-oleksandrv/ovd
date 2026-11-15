---
'@ovd/cli': patch
'@ovd/gui': patch
---

- With Vega SDK 2.0, the Virtual Device is listed as stopped before you start it for the first time, and `ovd vvd start` (or Start in the desktop app) starts it. Before, OVD said the SDK had no Virtual Device until it had been started once with `vega virtual-device start`.
