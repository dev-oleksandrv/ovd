---
'@ovd/cli': minor
---

- `ovd reboot` restarts the target and returns once it is back online, with `--timeout` (30–600 s, default 120) and `--json`. It exits 1 when the device doesn't come back in time, and 4 when there is no online target.
- Devices has a "Reboot & wait" button: the device shows "Rebooting…" until it is back online, then a toast says how long it took. The remote, the live view and the log stream pick up again on their own.
- On a Fire TV stick, rebooting and reconnecting over Wi‑Fi afterwards aren't checked on a stick yet.
