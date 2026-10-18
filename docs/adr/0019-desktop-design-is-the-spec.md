# 0019. The desktop design is the spec

- Status: Accepted
- Date: 2026-10-15

## Context

The desktop app has many screens with specific layout, copy and states. Improvised UI drifts from the design, produces inconsistent copy, and shows data the SDK can't provide. A dedicated design, OVD Desktop v2 in Claude Design, already defines every screen, its states and the stage that introduces it.

## Decision

- The design lives in Claude Design: [OVD Desktop v2](https://claude.ai/design/p/11662d93-ccfb-4d11-9761-b6fd499be3fd?file=OVD+Desktop+v2.dc.html). UI changes are made there first, then implemented.
- The design is the source of truth for layout, copy, states and colors. When code and design disagree, follow the design or update the design first.
- Dark theme only. Colors come from design tokens: background `#0B0E12`, text `#E7EBF0`, accent `#7CE0C3`, warning `#F2C26B`, error `#FF7A7A`, info `#7AB8FF`, muted `#8E98A6`, plus log-level colors.
- Fonts: Geist for UI, Geist Mono for IDs, commands and logs. Material Symbols for icons.
- Screens are built from a shared set of base components that live in `apps/gui`, not in core. A dev-only gallery page shows every base component in every state.
- Every screen has loading, empty and error states, plus an offline-target state when it talks to a device.
- No impossible states: the UI never shows data the SDK can't provide, such as uptime, storage, a "Developer Mode off" device, or Home on the Virtual Device.

## Consequences

- UI work starts from the design. The design is not copied into the repo; when it can't be opened, the screen is provided as an export or screenshot.
- Copy changes go through the design, not straight into code.
- A light theme would need a new decision.
