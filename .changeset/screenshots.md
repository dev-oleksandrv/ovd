---
'@ovd/cli': minor
---

- `ovd screenshot` saves a PNG of the target's screen to `~/ovd/captures` (or `--out <file or folder>`, `--force` to replace a file) and copies it to the clipboard with `--clipboard`. The Virtual Device is captured over emulator gRPC; Fire TV sticks through `gwsi-tool-screenshooter`, which isn't checked on a stick yet.
- The desktop's Remote & Screen has a Screenshot button and a Captures list, and the ⌘K palette has "Take screenshot": one click saves the screen and puts it on the clipboard.
