import { spawnSync, type ChildProcess } from 'node:child_process'
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
  processesFile,
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
// When a test ends: how long a surface process gets to exit by itself (a test that signalled it
// but didn't await it), then after SIGTERM, before SIGKILL; and how long a fake SDK process gets
// to go (the desktop's will-quit SIGTERMs its groups without waiting for them).
const EXIT_BY_ITSELF_MS = 1_000
const EXIT_AFTER_SIGTERM_MS = 2_000
const FAKE_EXIT_MS = 3_000

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
  // A surface process the harness started (ovd, Electron), stopped by close() if still running.
  track(child: ChildProcess): void
  // Stops what the test left running, then removes the sandbox. Throws when a surface ran an SDK
  // command the fake has no recording for (that flow ran something unverified), or when a
  // surface or fake SDK process was still running after the test (it would outlive the run).
  close(): Promise<void>
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

  // Like pidsIn, but a fake killed while appending may leave a cut last line.
  function fakePids(): number[] {
    const file = processesFile(sdkDir)
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((l) => {
        try {
          const { pid } = JSON.parse(l) as { pid: unknown }
          return typeof pid === 'number' ? [pid] : []
        } catch {
          return []
        }
      })
  }

  // Held commands answer and end once the hold is released (the fake re-polls it every 100 ms).
  function releaseHolds(): void {
    try {
      const w = readWorld(sdkDir)
      if (w.hold.length > 0) writeWorld(sdkDir, { ...w, hold: [] })
    } catch {
      // A world being rewritten right now: the cleanup below stops what it holds anyway.
    }
  }

  const tracked: ChildProcess[] = []

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

    track(child) {
      tracked.push(child)
    },

    async close() {
      // Taken first, so nothing the cleanup below triggers changes this check.
      const unhandled = [
        ...readCalls()
          .filter((c) => !c.handled)
          .map((c) => c.command),
        ...emulator.unhandled()
      ]
      const left: string[] = []
      try {
        releaseHolds()
        const [children, fakes] = await Promise.all([
          Promise.all(tracked.map(stopChild)),
          waitForPids(fakePids, FAKE_EXIT_MS)
        ])
        left.push(...children.flat(), ...fakes)
        // A fake started while a surface was being stopped, or one a SIGKILLed surface left
        // (a fake SIGKILLed above may still show here: listed once).
        for (const p of await waitForPids(fakePids, 0)) if (!left.includes(p)) left.push(p)
      } finally {
        emulator.close()
        rmSync(root, { recursive: true, force: true })
      }
      const problems: string[] = []
      if (unhandled.length > 0) {
        problems.push(
          `The fake SDK has no recording for:\n${unhandled.map((c) => `  ${c}`).join('\n')}`
        )
      }
      if (left.length > 0) {
        problems.push(
          `Still running after the test, stopped now:\n${left.map((p) => `  ${p}`).join('\n')}`
        )
      }
      if (problems.length > 0) throw new Error(problems.join('\n'))
    }
  }
}

const isRunning = (child: ChildProcess) => child.exitCode === null && child.signalCode === null

// Resolves true once the child has exited, false after `ms`.
function exitWithin(child: ChildProcess, ms: number): Promise<boolean> {
  if (!isRunning(child)) return Promise.resolve(true)
  return new Promise((resolveExit) => {
    const onExit = () => {
      clearTimeout(timer)
      resolveExit(true)
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolveExit(false)
    }, ms)
    child.once('exit', onExit)
  })
}

// Stops a surface process still running: SIGTERM first, so ovd or the desktop stops its SDK
// groups, then SIGKILL. Returns it ("pid command") when the harness had to stop it.
async function stopChild(child: ChildProcess): Promise<string[]> {
  if (await exitWithin(child, EXIT_BY_ITSELF_MS)) return []
  const what = `${child.pid ?? '?'} ${child.spawnargs.join(' ')}`
  child.kill('SIGTERM')
  if (!(await exitWithin(child, EXIT_AFTER_SIGTERM_MS))) {
    child.kill('SIGKILL')
    await exitWithin(child, EXIT_AFTER_SIGTERM_MS)
  }
  return [what]
}

// The command of a pid, or null when it is gone.
function commandOf(pid: number): string | null {
  const ps = spawnSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })
  const command = ps.status === 0 ? ps.stdout.trim() : ''
  return command === '' ? null : command
}

// Gives the fake SDK processes up to `ms` to exit, then SIGKILLs the ones still running and
// returns them ("pid command"). The command check guards against a reused pid; a zombie
// (`<defunct>`, its parent hasn't reaped it yet) no longer runs main.ts and is left to its parent.
async function waitForPids(pids: () => number[], ms: number): Promise<string[]> {
  const deadline = Date.now() + ms
  while (stillRunning(pids()).length > 0 && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  const left: string[] = []
  for (const pid of stillRunning(pids())) {
    const command = commandOf(pid)
    if (command === null || !command.includes(FAKE_SDK_MAIN)) continue
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // Exited just now.
    }
    left.push(`${pid} ${command}`)
  }
  return left
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
