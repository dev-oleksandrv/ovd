# 0022. Host state directory

- Status: Accepted
- Date: 2026-10-20

## Context

Stage 1 needs state that outlives one command: the selected target device ("the target is remembered between launches"), the names users give their devices (the SDK reports no friendly name), and paired Wi‑Fi devices, which stay listed as offline until they reconnect. The activity log (ADR 0011) also needs a home. The CLI, the desktop app and later the MCP server each run their own core (ADR 0001), and they must agree on this state: a target set in the desktop is the target for `ovd devices`.

## Decision

- One directory per user, shared by every surface: `OVD_HOME` if set, else `$XDG_CONFIG_HOME/ovd`, else `~/.config/ovd`. The same rule on macOS and Ubuntu (ADR 0013). It is created on first write with mode `0700`.
- `state.json` holds `{version: 1, target?, names, saved}`: the target device ID, device names keyed by serial, and saved Wi‑Fi devices (`id`, `serial`, `savedAt`). Core validates it on every read. Writes go to a temporary file that is then renamed, so readers never see a partial file.
- A `state.json` that can't be parsed or has another `version` is moved to `state.json.bak` and OVD starts from an empty state. A bad file never makes a command fail.
- `activity.jsonl` holds the activity log (ADR 0011): one JSON object per line, appended. Past 5 MiB it is renamed to `activity.1.jsonl`, replacing the previous one.
- The directory never holds credentials, tokens or Amazon account data (ADR 0015).

## Consequences

- The CLI and the desktop app see the same target, names and saved devices.
- Concurrent writers to `state.json` are last-writer-wins. That is acceptable for user-driven changes like setting a target; anything that needs stronger guarantees gets its own file.
- `OVD_HOME` makes tests, CI and several isolated setups on one machine easy.
- A later state format bumps `version` and adds a migration in core.
