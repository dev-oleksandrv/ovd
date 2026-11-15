---
'@ovd/cli': patch
'@ovd/gui': patch
---

- Typing into a Fire TV stick (`ovd input text`, desktop "Type into TV") now refuses text the stick would silently drop: accents, emoji and other non-ASCII characters, and `* + < > ^ | ~`. Before, the stick reported success and typed nothing of them.
- Pairing a stick over Wi‑Fi (`ovd pair --usb`) and switching it back (`ovd forget`) no longer fail when the SDK switches the stick but prints nothing, which could leave the stick in TCP/IP mode and invisible.
