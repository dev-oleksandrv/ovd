---
'@ovd/cli': patch
'@ovd/gui': patch
---

- Closing the terminal while `ovd logs` or `ovd doctor` runs now stops the SDK processes OVD started, and the command exits 129.
- `ovd logs` and the desktop's log export show control characters in device log lines as visible escapes, so an app's log can't move the cursor, recolor or reorder the terminal. `--json` keeps the text exact.
- Desktop Logs: when the only online stick reboots and no target is remembered, the session stays on screen with its "Reconnecting" note and reconnects, instead of starting over.
- Desktop Logs: a session that ended on a target that is now offline shows the offline state with why it ended; Restart comes back with the device.
