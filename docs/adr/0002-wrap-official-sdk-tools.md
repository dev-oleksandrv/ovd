# 0002. Wrap the official Vega SDK tools

- Status: Accepted
- Date: 2026-10-14

## Context

The Vega SDK already does everything OVD needs, across about ten tools and two shells: `vega`, VDA, `vpm`, `vlcm`, `vmsgr`, `loggingctl`, `inputd-cli`, `vpt` and `perf`. Their device protocols are undocumented and change between SDK versions. The SDK license does not allow redistributing its binaries, and the SDK has its own installer and version manager.

## Decision

- OVD wraps the official tools. It never talks device protocols directly and never reimplements what a tool already does.
- OVD uses the user's installed SDK (discovered from `~/vega` and `vega sdk list-installed`) and refuses to run device commands without one, with an install hint.
- OVD never bundles, copies or downloads SDK binaries.
- VDA is called through `vega exec vda`, not from PATH.
- Device-side tools run through `vega exec vda shell`.
- The one planned exception is the Virtual Device's emulator gRPC endpoint for screen and input, where the SDK tools don't work (ADR 0010).

## Consequences

- OVD keeps working as the SDK evolves, as long as the adapters keep up with output changes (ADR 0007).
- Users must install the SDK before OVD is useful. Doctor makes that the first check.
- OVD inherits SDK limitations and bugs. It works around them visibly (ADR 0012, ADR 0014) rather than replacing the tool.
- Every command OVD shows in its UI is a command it really runs, which doubles as documentation of the SDK.
