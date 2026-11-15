# 0027. Two backends for screen and input, with core's own emulator client

- Status: Accepted
- Date: 2026-11-15

Decided by the maintainer at the Stage 4 sign-off on 2026-11-12 (#119) and first written as an amendment to ADR 0010. Moved into this ADR on 2026-11-15 (#121, #124), because a changed decision gets a new ADR (`docs/adr/README.md`).

## Context

ADR 0010 split screen and input into two backends: `inputd-cli` and `gwsi-tool-screenshooter` on sticks, emulator gRPC on the Virtual Device, where those two tools don't work. It also said to prefer depending on or contributing to the community project vega-vvd-driver (MIT, TypeScript) for the Virtual Device backend over rebuilding it.

Building Stage 4.1 (PR #109) showed that OVD needs only a handful of emulator calls: the console's command that switches gRPC on, and the gRPC calls `sendKey`, `getScreenshot`, `streamScreenshot` and `getVmState`. The driver would have added `@grpc/grpc-js`, `@grpc/proto-loader` and the MCP SDK as dependencies for them. It also makes calls OVD must avoid: an authenticated `getStatus` stopped the Virtual Device during verification (ARCHITECTURE §8). This ADR supersedes 0010. It keeps 0010's other decisions unchanged.

## Decision

- Screen and input sit behind one core interface with two backends:
  - Sticks: `inputd-cli` (one persistent console session for low latency) and `gwsi-tool-screenshooter` plus `pull`.
  - Virtual Device: emulator gRPC (`sendKey`, `getScreenshot` for screenshots, `streamScreenshot` for the live view), enabled through the console on every Virtual Device start.
- The Virtual Device backend is a small emulator console and gRPC client in core (`packages/core/src/vvd/`), built on `node:net` and `node:http2`. OVD doesn't depend on vega-vvd-driver or on a gRPC library. It calls only the methods it needs and never `getStatus`; doctor probes with `getVmState`.
- Home is disabled on the Virtual Device with an explanation.
- Live view ships for the Virtual Device. Sticks show the latest screenshot with Refresh until their screenshot rate is measured on hardware.
- The console auth token is read at runtime and never logged.

## Consequences

- Two code paths to maintain and test.
- Doctor gets an "Emulator gRPC" row.
- This is the one place OVD talks to an endpoint directly instead of through an SDK tool, and only because the SDK tools don't work there (ADR 0002).
- No new dependencies. OVD maintains the wire format of the few calls it makes itself (`packages/core/src/vvd/grpcWire.ts`), and a new emulator call means extending that client.
- Fixes in vega-vvd-driver don't reach OVD on their own. Emulator behavior OVD relies on is recorded in ARCHITECTURE §8.
