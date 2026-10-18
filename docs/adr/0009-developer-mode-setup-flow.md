# 0009. Developer Mode is a setup flow, not a device state

- Status: Accepted
- Date: 2026-10-15

## Context

Developer Mode is required for sideloading, the developer shell, input and all VDA access over USB or the network. A stick without it does not appear in `vega device list` or `vda devices` at all. Enabling it takes on-device steps, a browser sign-in with an Amazon Developer account (`vega devmode login`) and a 6-digit code from the TV (`vega devmode enable-device --code`), after which the stick reboots. New users get stuck here before their first install.

## Decision

- Every listed device has Developer Mode on. OVD never shows a "Developer Mode off" device.
- When no stick is listed, doctor and the Devices screen explain that a stick without Developer Mode is invisible, and point to the setup wizard.
- The new-stick setup wizard (CLI `ovd setup-stick` and a desktop modal) walks through the on-device steps, sign-in, code entry, reboot and connecting over USB or Wi‑Fi, with explicit error states (not signed in, wrong or expired code, different networks, blocked port).
- The Virtual Device has no wizard: OVD offers a one-click `vsm developer-mode enable` when needed.
- OVD never stores Amazon credentials. Sign-in happens in the browser through the SDK.
- The wizard and Wi‑Fi pairing ship in the first release, because a new stick is unusable without them.

## Consequences

- The device list only contains devices OVD can act on.
- The wizard is the main onboarding path and must handle every documented failure.
- OVD can't detect a plugged-in stick without Developer Mode; it can only explain why it isn't listed.
