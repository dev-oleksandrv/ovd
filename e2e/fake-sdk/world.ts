import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The fake SDK's view of the host: what is plugged in, running and signed in. Tests set it up,
// the fake `vega` reads and updates it, so a flow sees the same effects a real SDK has
// (a started Virtual Device is listed, a switched stick leaves USB).
export interface World {
  // `vega --version` from the Vega CLI (SDK Manager) or the `vega` bundled inside an SDK.
  cli: 'manager' | 'bundled'
  vda: 'ok' | 'broken'
  // `expired`: `vega devmode login` says already signed in, but the session is rejected.
  account: 'signed-in' | 'signed-out' | 'expired'
  // When signed out: whether the user finishes the sign-in in the browser.
  browserSignIn: 'completes' | 'never'
  // The Developer Mode code the TV shows.
  tvCode: string
  stick: Stick | null
  vvd: { running: boolean; developerMode: boolean }
  // Addresses VDA holds a connection to (`vda connect`), kept across stick power cycles.
  vdaConnected: string[]
  // Packages `vega device install-app` put on a device, by device ID and recorded package.
  installed: { device: string; package: string }[]
  // Apps running on a device, by device ID and package ID (`com.example.player`). Recordings
  // exist for the player on the Virtual Device; the stick is recorded with nothing side-loaded.
  // `launch-app` adds the player, `vlcm terminate-app` and `uninstall-app` remove it.
  running: { device: string; app: string }[]
  // The Virtual Device player crashes right after `launch-app`, which still reports success
  // (ADR 0012): it never joins `running` (fixtures/0.24/README.md, row
  // `vlcm-crash-history/virtual-device-after.txt`: "the app never shows in `vlcm list`").
  playerCrashesOnLaunch: boolean
  // The Virtual Device player neither runs nor crashes after `launch-app`, which still reports
  // success (`vega-device-launch-app/launched.txt`): it never joins `running`, so
  // `vlcm list --app-id` answers `vlcm-list/app-missing.txt`, and the crash history keeps
  // `vlcm-crash-history/virtual-device-before.txt`. A sequence synthesized from recordings
  // (fixtures/0.24/README.md, Synthesized sequences). Not combined with `playerCrashesOnLaunch`.
  playerStopsOnLaunch: boolean
  // The player crashed: the crash history, the vault and the capture answer with their "after"
  // recordings (`vlcm-crash-history/virtual-device-after.txt`,
  // `loggingctl-vault-ls/virtual-device-tombstones-after.json`, `log-capture/virtual-device-crashed.txt`).
  playerCrashed: boolean
  // The stick's `loggingctl log -f`. They are read when a stream starts, so a test sets them
  // before it opens Logs or runs `ovd logs`; afterwards only `holdAfterLine: null` is polled.
  // `ends`: every stream prints the recording before a reboot and ends by itself (exit 0).
  // `holdAfterLine`: applies to every stream: each prints only that many lines of
  // `stick-follow.txt`, waits until the test sets it back to null, then prints the rest.
  // `ignoreFirstSigterm`: the stream ignores the first SIGTERM to its group and sets the flag
  // back to `false` in the world, so a test can see that it arrived. The next SIGTERM ends it.
  // `reboot` (absent is false): the next stream prints `stick-follow-reboot.txt` and ends with
  // exit 0, the stick is away for REBOOT_MS (not listed by `vda devices -l`), and the flag goes
  // back to false, so the stream after it prints `stick-follow.txt` (fixtures/0.24/README.md,
  // Synthesized sequences).
  logStream: {
    ends: boolean
    holdAfterLine: number | null
    ignoreFirstSigterm?: boolean
    reboot?: boolean
  }
  // How many `loggingctl log -f` streams the Virtual Device has started. The first prints
  // `loggingctl-log/virtual-device-restart-before.txt`, every later one
  // `virtual-device-restart-after.txt` (as recorded: a stream started right after another was
  // stopped), then each follows until its process group is signalled (fixtures/0.24/README.md,
  // Synthesized sequences).
  vvdLogStreams: number
  // When signed out, `vega devmode login --json` waits before it prints anything until it is
  // stopped, so a test can stop OVD while a probe runs. Doctor's own 5 s probe timeout still
  // applies. A timing knob (docs/conventions/testing.md): it delays the recorded answer, never
  // changes it.
  loginHold: boolean
  // Commands that wait before they answer: while a command starts with one of these, the fake
  // re-reads the world every 100 ms; once the test removes the entry it answers from the latest
  // world with its normal recording, so a flow can see the screen while the SDK works. Core's
  // runner is serial, so a held command holds every SDK call after it too. A timing knob
  // (docs/conventions/testing.md): it delays the recorded answer, never changes it.
  hold: string[]
  // Whether `~/.emulator_console_auth_token` exists, which the emulator console's `auth` needs.
  // Read when the sandbox opens.
  consoleToken: 'present' | 'missing'
  // Device temp files `gwsi-tool-screenshooter` wrote on the stick, until `rm -f` removes them.
  stickFiles: string[]
  // What the stick's screenshot holds: the synthetic PNG, or nothing (as verified on the
  // Virtual Device, an empty remote pulls an empty file with exit 0). Synthesized: the stick
  // backend is unverified on hardware (#44; fixtures/0.24/README.md, Synthesized sequences).
  stickScreenshot: 'image' | 'empty'
}

export interface Stick {
  developerMode: boolean
  // `tcpip`: listening on STICK_PORT (`vda tcpip` or Connection Mode on the TV), gone from USB.
  mode: 'usb' | 'tcpip'
  usbCable: boolean
  powered: boolean
  // Until this time (epoch ms) the stick is rebooting and not listed.
  rebootingUntil: number
}

// The values the recorded fixtures carry (fixtures/0.24/README.md); the fake can only answer
// with them, so tests use them too.
export const STICK_SERIAL = 'G070000000000001'
export const STICK_IP = '192.0.2.42'
export const STICK_PORT = 5555
export const STICK_ADDRESS = `${STICK_IP}:${STICK_PORT}`
export const VVD_VDA_SERIAL = 'emulator-5554'

// The script core sends to list every package (fixtures/0.24/vpm-info-package-all): the
// recordings were made with exactly this text, base64-encoded.
export const ALL_PACKAGES_SCRIPT = `d=$(mktemp -d) || exit 1
vpm list packages | tail -n +2 | xargs -P4 -n1 sh -c 'vpm info --package "$1" > "$0/$1"' "$d"
cat "$d"/*
s=$?
rm -rf "$d"
exit $s
`
export const ALL_PACKAGES = `echo ${Buffer.from(ALL_PACKAGES_SCRIPT).toString('base64')} | base64 -d | sh`

export function defaultWorld(): World {
  return {
    cli: 'manager',
    vda: 'ok',
    account: 'signed-in',
    browserSignIn: 'completes',
    tvCode: 'ABC123',
    stick: null,
    vvd: { running: false, developerMode: true },
    vdaConnected: [],
    installed: [],
    running: [],
    playerCrashesOnLaunch: false,
    playerStopsOnLaunch: false,
    playerCrashed: false,
    logStream: { ends: false, holdAfterLine: null },
    vvdLogStreams: 0,
    loginHold: false,
    hold: [],
    consoleToken: 'present',
    stickFiles: [],
    stickScreenshot: 'image'
  }
}

// A stick with Developer Mode on, plugged in over USB.
export function usbStick(overrides: Partial<Stick> = {}): Stick {
  return {
    developerMode: true,
    mode: 'usb',
    usbCable: true,
    powered: true,
    rebootingUntil: 0,
    ...overrides
  }
}

export function worldFile(dir: string): string {
  return join(dir, 'world.json')
}

// Where the fake emulator writes its discovery file (`OVD_EMULATOR_DISCOVERY_DIR`); the fake
// `vega virtual-device start` and `stop` empty it, as a restart turns gRPC off.
export function discoveryDir(dir: string): string {
  return join(dir, 'avd-running')
}

export function callsFile(dir: string): string {
  return join(dir, 'calls.jsonl')
}

// One `{ pid }` line per log stream the fake started, so a test can check none is left.
export function logStreamsFile(dir: string): string {
  return join(dir, 'log-streams.jsonl')
}

// One `{ pid }` line per `vega devmode login --json` the fake started, so a test can check none
// is left.
export function loginProbesFile(dir: string): string {
  return join(dir, 'login-probes.jsonl')
}

// One `{ line }` per line the fake `inputd-cli start` console read on stdin, in order, across
// consoles.
export function inputConsoleFile(dir: string): string {
  return join(dir, 'input-console.jsonl')
}

// One `{ pid }` line per `inputd-cli start` console the fake started, so a test can check none
// is left.
export function inputConsolesFile(dir: string): string {
  return join(dir, 'input-consoles.jsonl')
}

// One `{ tool, args, stdinBytes }` line per clipboard tool the CLI ran (`osascript`, `xclip`,
// `wl-copy` from the sandbox's fake bin folder), so no test touches the real clipboard.
export function clipboardCallsFile(dir: string): string {
  return join(dir, 'clipboard-calls.jsonl')
}

export function readWorld(dir: string): World {
  return JSON.parse(readFileSync(worldFile(dir), 'utf8')) as World
}

// Write then rename, so a `vega` started at the same moment never reads half a file.
export function writeWorld(dir: string, world: World): void {
  const tmp = `${worldFile(dir)}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(world, null, 2)}\n`)
  renameSync(tmp, worldFile(dir))
}

export interface Call {
  command: string
  handled: boolean
}
