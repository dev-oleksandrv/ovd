import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FAKE_CONSOLE_TOKEN, startFakeEmulator, type GrpcCall } from '../fake-sdk/emulator.ts'
import {
  callsFile,
  clipboardCallsFile,
  defaultWorld,
  discoveryDir,
  inputConsoleFile,
  inputConsolesFile,
  loginProbesFile,
  logStreamsFile,
  readWorld,
  writeWorld,
  type Call,
  type World
} from '../fake-sdk/world.ts'

const FAKE_SDK_MAIN = resolve(dirname(fileURLToPath(import.meta.url)), '../fake-sdk/main.ts')
const FAKE_CLIPBOARD = resolve(dirname(fileURLToPath(import.meta.url)), '../fake-sdk/clipboard.ts')
const CLIPBOARD_TOOLS = ['osascript', 'xclip', 'wl-copy']
// Where the SDK Manager installs the Vega CLI, and where an SDK keeps its bundled `vega`.
const MANAGER_VEGA = 'vega/bin/vega'
const BUNDLED_BIN = 'vega/sdk/0.24.12112/bin'

export interface ClipboardCall {
  tool: string
  args: string[]
  stdinBytes: number
}

export interface ActivityLine {
  surface: string
  action: string
  target: string | null
  args: Record<string, string | number | boolean>
  result: 'ok' | 'error'
  errorCode?: string
}

// One fake host per test: a home directory, the OVD state directory and a fake SDK. Nothing
// from the real machine leaks in: no real SDK, devices, OVD state or shell rc files.
export interface Sandbox {
  home: string
  ovdHome: string
  // Where screenshots go (`OVD_CAPTURES`).
  captures: string
  // Where the desktop "copies" a screenshot (`OVD_CLIPBOARD_FILE`) instead of the clipboard.
  clipboardFile: string
  // The environment a surface is started with.
  env: Record<string, string>
  installSdk(cli?: World['cli']): void
  world(): World
  update(change: (world: World) => void): void
  // Every SDK command run, as users read it (`vega exec vda devices -l`).
  calls(): string[]
  // Forgets the calls so far, so a test can check what one step ran.
  clearCalls(): void
  // The pid of every log stream (`loggingctl log -f`) the fake SDK started.
  logStreamPids(): number[]
  // The pid of every sign-in probe (`vega devmode login --json`) the fake SDK started.
  probePids(): number[]
  hostState(): unknown
  activity(): ActivityLine[]
  // The emulator gRPC calls made with the right token (fake-sdk/emulator.ts).
  grpcCalls(): GrpcCall[]
  // Every line the fake `inputd-cli start` consoles read, in order.
  inputConsole(): string[]
  // The pid of every `inputd-cli start` console the fake SDK started.
  inputConsolePids(): number[]
  // Every clipboard tool the CLI ran from the sandbox's fake bin folder.
  clipboardCalls(): ClipboardCall[]
  // Removes the sandbox; throws when a surface ran an SDK command the fake has no recording
  // for, since that flow ran something unverified.
  close(): void
}

// Test runners wrap this so each test gets its own sandbox (vitest.ts, gui.ts).
export function openSandbox(world: Partial<World> = {}): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'ovd-e2e-'))
  const home = join(root, 'home')
  const ovdHome = join(root, 'ovd')
  const sdkDir = join(root, 'fake-sdk')
  mkdirSync(home)
  mkdirSync(sdkDir)
  const initial = { ...defaultWorld(), ...world }
  writeWorld(sdkDir, initial)
  writeFileSync(callsFile(sdkDir), '')
  if (initial.consoleToken === 'present') {
    writeFileSync(join(home, '.emulator_console_auth_token'), `${FAKE_CONSOLE_TOKEN}\n`)
  }
  const emulator = startFakeEmulator(sdkDir)
  const captures = join(root, 'captures')
  const clipboardFile = join(root, 'clipboard.png')
  // Fake clipboard tools first on PATH: the real `osascript` is in /usr/bin on macOS.
  const fakeBin = join(root, 'bin')
  mkdirSync(fakeBin)
  for (const tool of CLIPBOARD_TOOLS) {
    const file = join(fakeBin, tool)
    writeFileSync(
      file,
      `#!/bin/sh\nexec '${process.execPath}' --no-warnings '${FAKE_CLIPBOARD}' '${clipboardCallsFile(sdkDir)}' ${tool} "$@"\n`
    )
    chmodSync(file, 0o755)
  }

  const path = [fakeBin, dirname(process.execPath), '/usr/bin', '/bin']
  const env: Record<string, string> = {
    HOME: home,
    OVD_HOME: ovdHome,
    // Doctor's Node check runs `$SHELL -ilc 'node --version'`; with this HOME it loads no rc file.
    SHELL: '/bin/sh',
    PATH: path.join(':'),
    TMPDIR: tmpdir(),
    // This sandbox's fake emulator, never a Virtual Device running on this host.
    OVD_EMULATOR_CONSOLE_PORT: String(emulator.consolePort),
    OVD_EMULATOR_GRPC_PORT: String(emulator.grpcPort),
    OVD_EMULATOR_DISCOVERY_DIR: discoveryDir(sdkDir),
    // Never the user's ~/ovd/captures, nor their clipboard (the desktop's testing hook).
    OVD_CAPTURES: captures,
    OVD_CLIPBOARD_FILE: clipboardFile,
    // `ovd reboot` waits 0.5 s of info answering instead of 8 s (a testing hook, as the ones above).
    OVD_REBOOT_SETTLE_MS: '500',
    LANG: 'en_US.UTF-8',
    // The display of a headless Ubuntu runner (xvfb-run), for the desktop app.
    ...(process.env.DISPLAY ? { DISPLAY: process.env.DISPLAY } : {}),
    ...(process.env.XAUTHORITY ? { XAUTHORITY: process.env.XAUTHORITY } : {})
  }

  function pidsIn(file: string): number[] {
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => (JSON.parse(l) as { pid: number }).pid)
  }

  function readCalls(): Call[] {
    return readFileSync(callsFile(sdkDir), 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l) as Call)
  }

  return {
    home,
    ovdHome,
    captures,
    clipboardFile,
    env,

    installSdk(cli = 'manager') {
      const file = join(home, cli === 'manager' ? MANAGER_VEGA : join(BUNDLED_BIN, 'vega'))
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(
        file,
        `#!/bin/sh\nOVD_FAKE_SDK_DIR='${sdkDir}' exec '${process.execPath}' --no-warnings '${FAKE_SDK_MAIN}' "$@"\n`
      )
      chmodSync(file, 0o755)
      // Only the SDK Manager's location is searched without PATH; a bundled `vega` is found on it.
      if (cli === 'bundled') env.PATH = `${dirname(file)}:${env.PATH}`
      const w = readWorld(sdkDir)
      writeWorld(sdkDir, { ...w, cli })
    },

    world: () => readWorld(sdkDir),

    update(change) {
      const w = readWorld(sdkDir)
      change(w)
      writeWorld(sdkDir, w)
    },

    calls: () => readCalls().map((c) => c.command),

    clearCalls: () => writeFileSync(callsFile(sdkDir), ''),

    logStreamPids: () => pidsIn(logStreamsFile(sdkDir)),

    probePids: () => pidsIn(loginProbesFile(sdkDir)),

    hostState() {
      const file = join(ovdHome, 'state.json')
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as unknown) : null
    },

    activity() {
      const file = join(ovdHome, 'activity.jsonl')
      if (!existsSync(file)) return []
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l) as ActivityLine)
    },

    grpcCalls: () => emulator.grpcCalls(),

    inputConsole() {
      const file = inputConsoleFile(sdkDir)
      if (!existsSync(file)) return []
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => (JSON.parse(l) as { line: string }).line)
    },

    inputConsolePids: () => pidsIn(inputConsolesFile(sdkDir)),

    clipboardCalls() {
      const file = clipboardCallsFile(sdkDir)
      if (!existsSync(file)) return []
      return readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => JSON.parse(l) as ClipboardCall)
    },

    close() {
      const unhandled = [
        ...readCalls()
          .filter((c) => !c.handled)
          .map((c) => c.command),
        ...emulator.unhandled()
      ]
      emulator.close()
      rmSync(root, { recursive: true, force: true })
      if (unhandled.length > 0) {
        throw new Error(
          `The fake SDK has no recording for:\n${unhandled.map((c) => `  ${c}`).join('\n')}`
        )
      }
    }
  }
}

// The pids that are still running (a pid that is gone answers ESRCH).
export function stillRunning(pids: number[]): number[] {
  return pids.filter((pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code !== 'ESRCH'
    }
  })
}
