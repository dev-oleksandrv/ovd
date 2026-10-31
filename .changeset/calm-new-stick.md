---
'@ovd/core': minor
'@ovd/cli': minor
'@ovd/gui': minor
---

Set up a new Fire TV stick: `ovd setup-stick` signs in to Amazon Developer Services in the browser (`vega devmode login`), turns on Developer Mode with the code the TV shows (`--code`, `--vendor`) and waits for the stick to come back on USB after its reboot (`--wifi` stops there for `ovd pair`). The desktop adds the setup wizard, opened from the target picker, the Devices hint and empty state, Doctor, the palette and the pairing wizard.
