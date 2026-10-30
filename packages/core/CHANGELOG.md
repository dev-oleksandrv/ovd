# @ovd/core

## 0.1.0

### Minor Changes

- 5634cda: Start and stop the Vega Virtual Device and turn on its Developer Mode: `ovd vvd start | stop | status` and `ovd vvd devmode enable`, plus Start/Stop in the desktop device detail, the Devices empty state, first run and the palette, and an Enable fix in Doctor when the Virtual Device has Developer Mode off.
- 030627b: Add `ovd doctor` and the desktop Doctor: checks the Vega SDK, VDA, devices, Developer Mode sign-in, Metro ports and Node, and opens on a first-run setup screen until the SDK and VDA work.
- 5048f5f: Pair Fire TV sticks over Wi‑Fi: `ovd pair --usb` switches a stick on USB to TCP/IP and connects to it, `ovd pair <ip>[:port]` connects to a stick already listening, and paired devices are remembered (`ovd connect <id>`; `ovd forget <id>` switches a stick paired over USB back to USB). The desktop adds the pairing wizard (Devices, target picker, palette), Reconnect and Forget on saved offline devices, and reconnects saved devices at launch and on Rescan.

## 0.0.1

No changes in this release.
