import type { ActivityLog } from '../activity/activityLog.js'
import { createPreflight } from '../activity/logged.js'
import { parseVdaPull } from '../adapters/parseVdaPull.js'
import { deviceScript } from '../deviceApps/launchScripts.js'
import type { Devices } from '../devices/devices.js'
import { onlineTarget } from '../devices/onlineTarget.js'
import type { Device } from '../devices/types.js'
import { OvdError } from '../errors/ovdError.js'
import { vdaCmd } from '../sdk/commands.js'
import type { Runner } from '../sdk/runner.js'
import type { SdkLocator } from '../sdk/sdkLocator.js'
import {
  commitFile,
  nodeSaveFs,
  readPart,
  resolveDestination,
  stageFor,
  type Staging,
  type Destination,
  type SaveFs,
  type SaveKind
} from '../screenshot/saveFile.js'
import { crashesDir, ensureCrashesDir } from './crashesDir.js'
import { parseCrashId, type CrashReader } from './crashList.js'
import type { Crash, CrashPullOptions, CrashPullResult } from './types.js'

export interface CrashPullDeps {
  // Authorizes the id: only an in-scope report is pulled (F4).
  reader: Pick<CrashReader, 'find'>
  runner: Runner
  sdk: SdkLocator
  devices: Devices
  activity: ActivityLog
  env: Record<string, string | undefined>
  homedir: string
  // Where a relative `--out` resolves; the process's working directory.
  cwd: string
  fs?: SaveFs
}

export const ACR_KIND: SaveKind = {
  ext: 'acr',
  noun: 'crash report',
  failure: 'CRASH_PULL_FAILED'
}

// A real report is about 300 KB (fixtures/0.24/loggingctl-vault-acr, pull-script-ok.txt).
export const MAX_ACR_BYTES = 4 * 1024 * 1024
const SCRIPT_TIMEOUT_MS = 30_000
const PULL_TIMEOUT_MS = 60_000
const RM_TIMEOUT_MS = 10_000
const RETRY = 'Check the device with ovd devices, then retry'

// The device script recorded in fixtures/0.24/README.md (`loggingctl-vault-acr/pull-script-*`),
// character for character: the fake SDK answers by this text. `umask 077` makes the folder and
// the file private to the app user; the report goes into a file, not through `vda`'s stdout,
// because it is binary. It exits 0 whatever happens: an unknown index (-8) or a refused one
// (-7) leaves its JSON error IN the file, so the pulled file is what tells them apart.
export function acrPullScript(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error(`crashPull: vault index isn’t a non-negative integer: ${index}`)
  }
  return `umask 077; d=$(mktemp -d /tmp/ovd-acr.XXXXXX) || exit 1; f="$d/report.acr"; loggingctl vault --cat SYSTEM_TOMBSTONE ${index} > "$f"; echo "$f"; wc -c < "$f"; ls -ld "$d" "$f"`
}

// The first two lines of the script's output: the file and its size. Only a path of exactly
// this shape is accepted, because its folder is what gets `rm -rf`-ed.
const REMOTE_FILE = /^(\/tmp\/ovd-acr\.[A-Za-z0-9]{6})\/report\.acr$/

export function parsePullScript(stdout: string): { folder: string; file: string; bytes: number } {
  const [file = '', size = ''] = stdout.split('\n').map((l) => l.trim())
  const match = REMOTE_FILE.exec(file)
  if (!match?.[1] || !/^\d{1,12}$/.test(size)) {
    throw new OvdError('CRASH_PULL_FAILED', 'The device gave an unexpected answer', RETRY)
  }
  return { folder: match[1], file, bytes: Number(size) }
}

// The folder to remove is found from the output even when the script failed after `mktemp`.
function folderIn(stdout: string): string | undefined {
  return REMOTE_FILE.exec(stdout.split('\n')[0]?.trim() ?? '')?.[1]
}

// An ACR starts with `Key: value` header lines (`AppBuildNumber: 1`); the JSON of a refused or
// unknown report starts with `{`. The header's `Size:` is NOT the file size, so it isn't used.
const HEADER_LINE = /^[A-Za-z][A-Za-z0-9_]*: [^\r\n]*(\r?\n|$)/

function failed(message: string): OvdError {
  return new OvdError('CRASH_PULL_FAILED', message, RETRY)
}

// What the pulled file says: -7 and -8 are `loggingctl`'s answers written into it.
function judge(bytes: Buffer, device: Device, crash: Crash): void {
  if (bytes.length === 0) throw failed(`${device.name} gave an empty crash report`)
  if (bytes[0] === 0x7b /* { */ && bytes.length <= 1024) {
    let status: unknown
    try {
      status = (JSON.parse(bytes.toString('utf8')) as { status?: unknown }).status
    } catch {
      // Not JSON: falls through to the header check.
    }
    if (status === -7) {
      throw new OvdError(
        'CRASH_ACCESS_DENIED',
        `${device.name} refused access to crash ${crash.id} of ${crash.package}`,
        'The app may have been uninstalled since it crashed'
      )
    }
    if (status === -8) {
      throw new OvdError(
        'CRASH_NOT_FOUND',
        `Crash ${crash.id} is no longer on ${device.name}`,
        'List them with ovd crashes'
      )
    }
  }
  if (!HEADER_LINE.test(bytes.subarray(0, 512).toString('latin1'))) {
    throw failed(`${device.name} gave something that isn’t a crash report`)
  }
}

function abortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

export interface CrashPull {
  pull(opts: CrashPullOptions): Promise<CrashPullResult>
  dir(): string
}

export function createCrashPull(deps: CrashPullDeps): CrashPull {
  const preflight = createPreflight(deps.activity)
  const fs = deps.fs ?? nodeSaveFs
  const dir = crashesDir(deps.env, deps.homedir)

  // The report is written into a private device folder and pulled into a private staging folder
  // on the host. The device folder is always removed afterwards, without the signal so Ctrl+C
  // still cleans up. The script itself also runs without the signal: it takes about a second, and
  // only its output names the folder to remove, so an abort mid-script would leave the dump behind.
  // Residual: when the runner fails or times out there is no output, so a folder the script made
  // stays in the device's /tmp until reboot (no wildcard `rm`: it could remove someone else's).
  async function fetch(
    device: Device,
    crash: Crash,
    dest: Destination,
    signal?: AbortSignal
  ): Promise<{ staging: Staging; bytes: Buffer }> {
    const { vegaPath } = await deps.sdk.get()
    const serial = device.vdaSerial ?? device.id
    const withSignal = signal ? { signal } : {}
    let folder: string | undefined
    try {
      let script
      try {
        script = await deps.runner.run(
          vdaCmd(vegaPath, ['shell', deviceScript(acrPullScript(crash.id))], serial, {
            timeoutMs: SCRIPT_TIMEOUT_MS
          })
        )
      } catch (error) {
        if (error instanceof OvdError && error.details?.timedOut === true) {
          throw failed(`Reading crash ${crash.id} on ${device.name} didn’t finish in time`)
        }
        throw error
      }
      folder = folderIn(script.stdout)
      if (signal?.aborted) throw abortError()
      if (script.exitCode !== 0) throw failed(`Couldn’t read crash ${crash.id} on ${device.name}`)
      const remote = parsePullScript(script.stdout)
      if (remote.bytes > MAX_ACR_BYTES) {
        throw failed(`Crash ${crash.id} on ${device.name} is larger than ${MAX_ACR_BYTES} bytes`)
      }

      // The folder is created only now, so a refused or unknown report leaves nothing behind.
      if (dest.kind === 'auto' && dest.create) await ensureCrashesDir(dest.dir)
      const ready = dest.kind === 'auto' ? { ...dest, create: false } : dest
      const staging = await stageFor(ready, ACR_KIND)
      try {
        const pull = parseVdaPull(
          await deps.runner.run(
            vdaCmd(vegaPath, ['pull', remote.file, staging.file], serial, {
              ...withSignal,
              timeoutMs: PULL_TIMEOUT_MS
            })
          )
        )
        if (!pull.ok) {
          throw failed(`Couldn’t pull crash ${crash.id} from ${device.name}: ${pull.message}`)
        }
        if (signal?.aborted) throw abortError()
        const bytes = await readPart(staging.file, ACR_KIND, MAX_ACR_BYTES)
        if (bytes === null) throw failed(`Crash ${crash.id} didn’t arrive from ${device.name}`)
        judge(bytes, device, crash)
        // The header's `Size:` is a different number; `wc -c` is the file's.
        if (bytes.length !== remote.bytes) {
          throw failed(`Crash ${crash.id} arrived with ${bytes.length} of ${remote.bytes} bytes`)
        }
        return { staging, bytes }
      } catch (error) {
        await staging.remove()
        throw error
      }
    } finally {
      if (folder !== undefined) {
        await deps.runner
          .run(
            vdaCmd(vegaPath, ['shell', 'rm', '-rf', folder], serial, { timeoutMs: RM_TIMEOUT_MS })
          )
          .catch(() => undefined)
      }
    }
  }

  return {
    dir: () => dir,

    async pull(opts) {
      const { device, crash, dest } = await preflight('crash.pull', async (log) => {
        const index = parseCrashId(opts.id)
        log.args.index = String(index)
        // The path is checked before any SDK call.
        const destination = await resolveDestination({
          out: opts.out,
          force: opts.force ?? false,
          cwd: deps.cwd,
          capturesDir: dir,
          kind: ACR_KIND
        })
        const target = await onlineTarget(deps.devices, opts.device)
        log.target = target.id
        // Only a report of the developer's own app (F4); the same check as the detail view.
        const found = await deps.reader.find(index, target.id)
        return { device: target, crash: found.crash, dest: destination }
      })
      if (opts.signal?.aborted) throw abortError()

      const epoch = Math.floor(Date.parse(crash.time) / 1000)
      const base = `${crash.package}-${epoch}-${crash.pid}`
      // Validated fields only: no report text reaches the log.
      const args = { package: crash.package, index: crash.id, pid: crash.pid, signal: crash.signal }
      let staging: Staging | undefined
      try {
        const got = await fetch(device, crash, dest, opts.signal)
        staging = got.staging
        // Cancelled during the remote cleanup: nothing is published or logged.
        if (opts.signal?.aborted) throw abortError()
        const path = await commitFile(staging.file, dest, base, fs, ACR_KIND)
        await deps.activity.append({
          action: 'crash.pull',
          target: device.id,
          args: { ...args, bytes: got.bytes.length },
          result: 'ok'
        })
        return { crash, path, bytes: got.bytes.length }
      } catch (error) {
        if (opts.signal?.aborted) throw abortError()
        if (error instanceof OvdError) {
          await deps.activity.append({
            action: 'crash.pull',
            target: device.id,
            args,
            result: 'error',
            errorCode: error.code
          })
        }
        throw error
      } finally {
        await staging?.remove()
      }
    }
  }
}
