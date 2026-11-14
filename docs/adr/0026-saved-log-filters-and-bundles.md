# 0026. Saved log filters and log bundles

- Status: Accepted
- Date: 2026-11-14

Decided by the owner, with the approval of the Stage 5.2 plan on 2026-11-14.

## Context

Stage 5.2 (log power tools) adds three things that touch the host: filters the user can name and reuse, a "bundle" file made to be attached to a bug report, and per-process display rules. The first two are a new persisted store and a new place OVD writes files, so they need an ADR (ADR 0022 lists what lives in the state directory; `docs/adr/README.md` asks for an ADR for every new persisted store).

Three facts shape the decisions, all checked on 2026-11-14 on the Virtual Device and a stick (SDK 0.24.12112; `docs/ARCHITECTURE.md` §8):

- `vega exec vda shell` re-wraps its command in a host shell, so text typed by the user must never become a device command argument. `loggingctl log` can filter on the device (`-P`, `-T`, `-a`, `-t`, `-F`, `-b`, `-v`), but OVD filters on the host in core, and a filter change never restarts the stream.
- `loggingctl config` (level, rate, mute per process) writes state on the device that stays after the command and after an app relaunch, until a reset. On the Virtual Device it did not stop the app's JS `console.*` lines. It also answers with exit 0 on failure.
- Log lines can hold tokens, user data and addresses. A file made to be shared needs a fixed list of contents.

## Decision

### Saved filters

- One file, `log-filters.json`, in the host state directory of ADR 0022 (`$OVD_HOME`). It holds `{version: 1, filters: [{name, filter}]}`. The file is `0600` in the `0700` directory, is written with the same temporary-file-then-rename write as `state.json`, and is last-writer-wins. It holds no secrets.
- Filters are global, not per device.
- `filter` has the fields of a CLI filter (`app`, `system`, `level`, `grep`, `regex`, `pid`, `tid`, `tag`, `identity`, `facility`) and the per-process rules (level, rate, mute per identity). It never holds `since`, `until` or a `boot` ID, which are bound to a time or to one boot.
- Names are 1–40 characters of `[a-z0-9-]`, starting with a letter or a digit, so a name works as a CLI argument. They are unique, the four built-in preset keys (`all`, `app-errors`, `network`, `lifecycle`) are reserved, and the store holds at most 50. A bad name is `INVALID_LOG_FILTER_NAME`; a full store, or an existing name without `--force`, is `LOG_FILTER_EXISTS` (both exit 2).
- Everything read back is untrusted, like any file on disk. Each entry is validated with zod and compiled again with `compileLogFilter`, which refuses unsafe regexes (nested quantifiers, backreferences, lookbehind, over 512 characters). An entry that fails is listed with `valid: false` and its error, can't be applied (`INVALID_LOG_FILTER`, exit 2) and can be deleted. A missing file is an empty list. A file that can't be read or parsed is `LOG_FILTERS_UNREADABLE` (exit 1); unlike `state.json` it is not moved aside, because replacing it would destroy the user's saved filters.
- Saving and deleting a filter changes host files only, so it writes no activity entry (ADR 0011 covers device actions).
- It is a separate file, not a field of `state.json`: `state.json` is parsed by a strict zod object that drops unknown keys, so an older OVD reading and rewriting it would silently delete the filters. The two files also change at different times and for different reasons.

### Bundles

- A bundle is one `.zip`, written by a small writer in core (local headers, central directory, deflate through Node's `zlib`, its own CRC-32). It adds no dependency and needs no host tool.
- Location: `~/ovd/bundles/` (`OVD_BUNDLES` overrides it), next to captures and crashes (ADR 0022, amendment of 2026-11-12). The folder is `0700` and the file `0600`. OVD builds the name, `ovd-logs-<device name slug>-<UTC yyyymmdd-hhmmss>.zip`, and never takes any part of it from device text.
- It is saved with the hardened save of Stage 5.1: written as a `.part` file, then linked into place, with no symlinked folder or destination and no overwrite without `--force`. `--out <path>` works as in `ovd screenshot`. The log export's file handling (no mode, no symlink check) is not reused.
- Contents, all from fixed templates or validated fields except the logs:
  - `README.txt`: a fixed text saying that the bundle may hold secrets from the app's logs, to review it before sharing, and what each file is;
  - `manifest.json`: OVD version, SDK version, target kind, device name, model, OS version, architecture, time range, line count, filter and preset name;
  - `logs.txt` (the export text format) and `logs.jsonl` (the `--json` line format);
  - `apps.json`: the target's side-loaded packages, ID and version;
  - `crashes.json`: the crash list of Stage 5.1 for the target, metadata only.
- If the apps or the crash read fails, the bundle is still written, and the manifest records `"apps": "unavailable"` or `"crashes": "unavailable"` with the error code.
- Never in a bundle: serials, IP addresses or hostnames that OVD generated (the manifest names the device by its OVD name), ACR files, screenshots, `activity.jsonl` (it holds search text), doctor output, the emulator console token, and any host path other than the bundle's own name.
- Log text is copied as received, with no redaction. `README.txt` says so.
- A bundle writes one activity entry, `logs.bundle`, with validated fields only: device, line count, bytes and file name. No filter text and no log lines.

### No `loggingctl config`

OVD never calls `loggingctl config`. Per-process level, rate limit and mute are host-side display rules, kept in the filter and applied in core, in stream order and deterministically. The reasons, from the checks above:

- the setting stays on the device after OVD exits, so a forgotten rule keeps hiding an app's lines for everyone, including the developer's next tool;
- on the Virtual Device it missed the app's JS `console.*` lines, so a rule would look applied while the lines kept coming;
- it exits 0 when it fails, and it is refused for system processes, so it can't cover "any process";
- every value would have to reach a device command.

## Consequences

- Saved filters, presets and rules work the same on every device and in both surfaces, and nothing the user types reaches a device shell.
- Rate limiting on the host hides lines OVD already received; it does not reduce load on the device.
- A saved filter written by a newer OVD with fields an older one doesn't know is shown as invalid by the older one and can still be deleted. A later format bumps `version` and adds a migration.
- A bundle is safe to build and unsafe to share blindly: the warning is in the file, and the owner of the logs reviews them. Redaction is out of scope.
- The zip writer is ours to maintain: no zip64 (a bundle over 2 GiB is refused) and names are checked on write.
- Export, import and sharing of saved filters, per-device filters, and a fix for the log export's file mode and symlink handling are follow-ups, not part of this decision.
