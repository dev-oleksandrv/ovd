---
'@ovd/core': minor
'@ovd/cli': minor
'@ovd/gui': minor
---

Pair Fire TV sticks over Wi‑Fi: `ovd pair --usb` switches a stick on USB to TCP/IP and connects to it, `ovd pair <ip>[:port]` connects to a stick already listening, and paired devices are remembered (`ovd connect <id>`; `ovd forget <id>` switches a stick paired over USB back to USB). The desktop adds the pairing wizard (Devices, target picker, palette), Reconnect and Forget on saved offline devices, and reconnects saved devices at launch and on Rescan.
