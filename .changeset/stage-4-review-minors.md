---
'@ovd/cli': patch
'@ovd/gui': patch
---

Fixes for the Remote & Screen, screenshots, reboot and Virtual Device flows:

- Desktop: the "Type into TV" Send button no longer spins forever, and failed key presses, screenshots and captures reads now show an error instead of failing silently.
- Desktop: "No signal" on the Virtual Device's live view now has Retry, a stick's screenshot is marked "Out of date" only for keys sent to that stick, and a Refresh that finishes after you switch sticks no longer shows on the other one.
- Desktop: Start and Doctor's "Turn on" for the Virtual Device no longer run at the same time, and quitting while a stick's remote is still connecting closes it cleanly.
- Doctor shows "Waiting for the Virtual Device" instead of a gRPC warning while OVD is still starting it.
- `ovd vvd start`: turning on emulator gRPC gives up after about 11 s instead of up to a minute when the console doesn't answer, and Ctrl+C once the Virtual Device is online reports it started (with a gRPC warning) instead of "Cancelled".
- `ovd input text` on a stick accepts a text of only spaces.
- `ovd screenshot` refuses a PNG that was cut short, and Ctrl+C during `--clipboard` keeps the saved file and says so.
- `ovd reboot`: Ctrl+C before anything was sent says "Nothing was sent to the device", and a Ctrl+C while the reboot command runs is now in the activity log.
