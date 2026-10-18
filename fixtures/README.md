# Fixtures

Recorded Vega SDK outputs, used by parser and core tests so the test suite runs without hardware (ADR 0007).

## Layout

```
fixtures/<sdk-version>/<tool>/<case>.<ext>
```

- `<sdk-version>`: the SDK version the output was recorded with, e.g. `0.24`.
- `<tool>`: the command, kebab-case, e.g. `vega-device-info`, `vpt-info`, `vda-devices`.
- `<case>`: what the output shows, e.g. `stick-usb.json`, `virtual-device-aarch64.json`, `no-devices.txt`.

When an SDK version changes a tool's output, add a new version folder. Keep the old one while its adapter is supported.

## Recording

1. Run the exact command core runs and save raw stdout (plus stderr and the exit code when the parser uses them).
2. Sanitize before saving (ADR 0016):
   - serials → fake serials (`G070000000000001`)
   - IPs → documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, `2001:db8::/32`)
   - hostnames, account emails → placeholders
   - app IDs → `com.example.player`, `com.example.player.debug`, `com.example.hellovega`
   - device names → Fire TV Stick 4K Select, Living room stick, Bedroom stick, Vega Virtual Device
3. Add a line to the version folder's `README.md`: file, command, device type, date.
4. Never hand-edit a fixture's structure to make a test pass. Re-record instead.
