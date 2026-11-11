---
'@ovd/cli': minor
'@ovd/gui': minor
---

- `ovd vvd start` now turns on the Virtual Device's emulator gRPC endpoint every time, also on a Virtual Device that is already running, and prints `Emulator gRPC on · :8554`. If it can't, the start still succeeds and you get a warning with a fix hint. `--json` reports it as `vvd.grpc`. This is what OVD will use to send remote keys to the Virtual Device.
- `ovd doctor` has a new "Emulator gRPC" row: `On · :8554`, `Not running` when the Virtual Device is stopped, or `Couldn’t enable` with a hint to run `ovd vvd start`.
- Desktop: Doctor shows the same row, with a Turn on button when gRPC is off. Starting the Virtual Device warns if gRPC couldn't be turned on. The status bar shows the matching `ovd vvd start` command.
