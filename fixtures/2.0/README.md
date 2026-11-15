# SDK 2.0 fixtures

Recorded by the nightly SDK check (`scripts/nightly-sdk-check.mjs`, run 43705903299 on `main`) with Vega SDK 2.0.13986 and Vega CLI 1.4.9 on Ubuntu (x86_64), against a headless Virtual Device (x86_64) started with `--no-gui --no-gl-accel`. The script sanitized the recordings; on review the device's host name (`amazon-0000000000000000`), its `idme` (`A000000000000`), the boot ID (`00000000-0000-4000-8000-000000000001`, and the same without dashes in the log), the Virtual Device instance ID (`00000000-0000-4000-8000-000000000000`), the sign-in user code (`ABC123`) and a system crash's descriptor and fingerprint hashes (zeros) were replaced too. The home folder is `/home/user`. The throwaway app is the `helloWorld` template generated as `com.example.hellovega` and built with `npm run build:debug` (pure JS, Debug x86_64). The nightly recorded each call; nine identical `vega virtual-device status` answers and the second `is-port-forwarded` (port 8097, the same `false`) were dropped as duplicates.

| File | Command | Device | Date |
| --- | --- | --- | --- |
| `vega-version/manager.txt` | `vega --version` (Vega CLI, `~/vega/bin/vega`; exit 0) | — | 2026-11-15 |
| `vega-project-generate/hellovega.txt` | `vega project generate -t helloWorld -n hellovega --packageId com.example.hellovega -o <dir>` (exit 0): the template now targets OS 2.0 (`target=2.0, min=2.0`) | — | 2026-11-15 |
| `vega-virtual-device-status/no-instance.txt`, `no-instance.stderr.txt` | `vega virtual-device status` (**exit 1**) before the first start: `cannot find virtual device instance: default_instance` on both streams, stdout with the `virtualdevice status` command it ran. The Virtual Device is installed; `start` creates the instance | Virtual Device never started | 2026-11-15 |
| `vega-virtual-device-start/started.txt`, `started.stderr.txt` | `vega virtual-device start --no-gui --timeout 300 --no-gl-accel` (exit 0, about 33 s on the runner): `Instance created: <sdk>/vvd/instances/<uuid>` first, then the 0.24 lines. stderr has SDK log lines only | Virtual Device never started | 2026-11-15 |
| `vega-virtual-device-status/running.json`, `running.stderr.txt` | `vega virtual-device status` (exit 0): the 0.24 JSON line; stderr has one SDK log line | Virtual Device running | 2026-11-15 |
| `vda-devices/virtual-device.txt` | `vega exec vda devices -l` (exit 0): the Virtual Device's line now has a `vda:` field | Virtual Device running | 2026-11-15 |
| `vega-device-info/virtual-device.json` | `vega device info --device VirtualDevice` (exit 0): `os` is `vega`, `buildDescription` `OS 2.0 (…)`, `product` `vvrp-tv-x64` | Virtual Device (x86_64) | 2026-11-15 |
| `vega-sdk-config-doctor/ok.json` | `vega sdk config doctor --json` (exit 0) | — | 2026-11-15 |
| `vda-version/ok.txt` | `vega exec vda version` (exit 0): VDA 2.13 | — | 2026-11-15 |
| `vega-device-is-port-forwarded/false.txt` | `vega device is-port-forwarded --port 8081 --forward false --device VirtualDevice` (exit 0) | Virtual Device (x86_64) | 2026-11-15 |
| `vsm-developer-mode/enabled.txt` | `vega exec vda -s emulator-5554 shell vsm developer-mode` (exit 0) | Virtual Device (x86_64) | 2026-11-15 |
| `vega-devmode-login/signed-out.json` | `vega devmode login --json` (stdout; stopped by OVD after `pending`, exit 143); user code replaced | — signed out | 2026-11-15 |
| `vpt-info/hellovega-x86_64-debug.json` | `vega exec vpt info --json <file>` (exit 0): `os_versions` `1.2` and `2.0` | — hellovega, Debug x86_64 | 2026-11-15 |
| `vpt-show-contents/hellovega.txt` | `vega exec vpt show-contents <file>` (exit 0): no `lib/` | — hellovega, Debug x86_64 | 2026-11-15 |
| `vpt-dump-app-config/hellovega-debug.json` | `vega exec vpt dump <file> assets/raw/keplerscript-app-config.json` (exit 0): `developmentEnabled` `true` | — hellovega, Debug x86_64 | 2026-11-15 |
| `vpt-checksum/hellovega-x86_64-debug.txt` | `vega exec vpt checksum <file>` (exit 0) | — hellovega, Debug x86_64 | 2026-11-15 |
| `vega-device-install-app/installed.txt` | `vega device install-app -p <file> --device VirtualDevice` (stdout, exit 0) | Virtual Device (x86_64) | 2026-11-15 |
| `vpm-info-package/hellovega.txt` | `vega exec vda -s emulator-5554 shell vpm info com.example.hellovega --package` (exit 0): the 0.24 fields, the SDK's debug signer blocks | Virtual Device (x86_64) — hellovega installed | 2026-11-15 |
| `vlcm-list/hellovega-stopped.txt` | `… shell vlcm list --app-id com.example.hellovega.main` (exit 0), before the launch: the header only | Virtual Device (x86_64) — hellovega installed, not running | 2026-11-15 |
| `vlcm-crash-history/virtual-device-empty.txt` | `… shell vlcm crash-history` (exit 0): capacity 10, size 0 | Virtual Device (x86_64) | 2026-11-15 |
| `log-capture/virtual-device-started.txt` | the capture start script (`timeout 200`, as core sends it; exit 0): file and `timeout` pid | Virtual Device (x86_64) | 2026-11-15 |
| `vega-device-launch-app/launched.txt` | `vega device launch-app -a com.example.hellovega.main --device VirtualDevice` (stdout, exit 0) | Virtual Device (x86_64) | 2026-11-15 |
| `vlcm-list/hellovega-running.txt` | `… shell vlcm list --app-id com.example.hellovega.main` after the launch (exit 0; the five polls printed the same): `VISIBLE`, `PERMANENT` | Virtual Device (x86_64) — hellovega running | 2026-11-15 |
| `log-capture/virtual-device-verified.txt` | the capture stop script with crash pid 0 (exit 0, 66 lines): the install and launch lines of `pkgmgrd`, `lcm_service`, `eventmgrd`, `splashservice` | Virtual Device (x86_64) | 2026-11-15 |
| `vda-shell/boot-id.txt` | `… shell cat /proc/sys/kernel/random/boot_id` (exit 0); ID replaced | Virtual Device (x86_64) | 2026-11-15 |
| `loggingctl-log/virtual-device-follow.txt` | `vega exec vda -s emulator-5554 shell loggingctl log -f -o short_concise` (stdout, stopped by OVD after about 16 s, exit 143), the whole session: 2904 lines, the journal backlog from the launch on, then the follow. The template app's native lines carry its full package ID (`com.example.hellovega[4097]`); `daemon.notice` lines appear | Virtual Device (x86_64) — hellovega running | 2026-11-15 |
| `vega-virtual-device-stop/stopped.stderr.txt` | `vega virtual-device stop` (**exit 0**, nothing on stdout): stderr has one SDK log line | Virtual Device running | 2026-11-15 |

Not answered by the e2e fake SDK, which answers with `fixtures/0.24` only (ADR 0023); core's adapter and device tests read every file here except `vega-project-generate/hellovega.txt`, `log-capture/virtual-device-verified.txt`, `vega-virtual-device-status/running.stderr.txt` and `vega-virtual-device-stop/stopped.stderr.txt`, which document what ARCHITECTURE §8 states.
