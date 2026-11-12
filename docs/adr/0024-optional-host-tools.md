# 0024. Optional host tools

- Status: Accepted
- Date: 2026-11-12

## Context

`ovd screenshot --clipboard` (Stage 4.3) copies a PNG to the system clipboard. The CLI has no clipboard API of its own: Node has none, and the desktop's Electron clipboard isn't available to a terminal process. Each platform already has a tool for it: `osascript` on macOS, and `wl-copy` (Wayland) or `xclip` (X11) on Ubuntu. AGENTS.md asks for an ADR when OVD depends on a new SDK tool. These aren't SDK tools, but they are programs OVD runs, and later features (opening a folder, maybe a notification) will want the same kind.

## Decision

- OVD may run a host tool that the operating system or a common package provides, for a convenience that isn't part of any device action. The first ones are the clipboard tools: `osascript` (macOS), then `wl-copy`, then `xclip` (Ubuntu).
- A host tool is always optional. No command needs one to do its main job: `ovd screenshot --clipboard` saves the PNG first and only then copies it. When no tool is found, the command fails with its own code (`CLIPBOARD_UNAVAILABLE`, exit 1) and a hint that names what to install. It never installs anything.
- Host tools are not SDK tools, so they don't go through the SDK runner and its serial queue. They follow the same rules (`docs/conventions/sdk.md`, Calling tools): an argument array (no shell, no user text in a script), a timeout (5 s for the clipboard), and nothing secret in the arguments. Core injects the call, so unit tests never run a real tool, and e2e puts fake tools on the `PATH`.
- The desktop uses Electron's own API where one exists (its clipboard) instead of a host tool.
- Each new host tool is listed in `docs/conventions/sdk.md` with the platform, the fallback order and its error code. A tool that a feature can't work without isn't optional, and needs its own ADR.

## Consequences

- `--clipboard` works on a stock macOS install. On Ubuntu it needs `wl-clipboard` or `xclip`, and the hint says so.
- The Linux fallback order is checked in CI, on `ubuntu-latest`, with fake tools on the `PATH`.
- OVD's only required programs stay the Vega SDK tools (ADR 0002).
