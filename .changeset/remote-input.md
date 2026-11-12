---
'@ovd/cli': minor
'@ovd/gui': minor
---

- `ovd input press <key...>` presses remote keys on the target, in order: `up`, `down`, `left`, `right`, `ok`, `back`, `home`, `menu`, `play-pause`, `rewind`, `fast-forward`. `ovd input text "<text>"` types text into the focused field. Both accept `--device` and `--json`. On the Virtual Device they go through emulator gRPC, which OVD turns on if needed. Home can't be sent there, and the Virtual Device types only printable ASCII. Both are refused with exit 2. On a Fire TV stick they go through `inputd-cli`; this isn't checked on a real stick yet. An unknown key or invalid text exits 2, and an offline target exits 4.
- Desktop: a new Debug → Remote & Screen screen has a remote pad with D-pad, OK, Back, Home, Menu, rewind, play/pause and fast-forward. Pressed keys flash. The keyboard works as a remote, with a hint listing the shortcuts. "Type into TV" sends text, and keys don't fire while you type in it. An input session panel shows the backend and the commands sent. Home is disabled on the Virtual Device, and an offline target shows "Remote unavailable — <device> is offline". Each press shows its `ovd input …` command in the status bar.
