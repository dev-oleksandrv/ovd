#!/usr/bin/env node
// The nightly SDK check (Stage 3.7, ADR 0007): runs the built CLI against the installed Vega SDK
// and a Virtual Device, records every SDK call OVD makes, sanitizes the recordings, and lays
// them out as fixtures when the SDK's major.minor has no fixtures folder yet.
// Usage: node scripts/nightly-sdk-check.mjs [--out <dir>] [--dry-run] [--keep-vvd]
//          [--project <dir>] [--record] [--self-test]
// --self-test checks the sanitizer, leak check and fixture naming on made-up input, with no
// SDK, device or network. Exit 0 when every step passed, 1 otherwise. Never runs `vega platform doctor`.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir, hostname, tmpdir, userInfo } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(root, 'apps', 'cli', 'dist', 'index.js')
const APP_ID = 'com.example.hellovega'
const VVD_ID = 'VirtualDevice'
const TOKEN_FILE = join(homedir(), '.emulator_console_auth_token')
const SAMPLE_NAMES = ['Living room stick', 'Bedroom stick', 'Fire TV Stick 4K Select']
// The device tools a `vda shell` call runs (docs/conventions/sdk.md); their name is the tool name.
const DEVICE_TOOLS = new Set([
  'vpm',
  'vlcm',
  'vmsgr',
  'loggingctl',
  'inputd-cli',
  'gwsi-tool-screenshooter',
  'ace_memusage',
  'vsm'
])

const STEPS = [
  'sdk-version: read `vega --version` and compare major.minor to the newest fixtures/<x.y>/',
  'shim: write a recording `vega` shim and point OVD_VEGA at it',
  'project: generate com.example.hellovega in a temp dir, npm install, npm run build:debug',
  'vvd-start: start the Virtual Device headless unless it already runs',
  'vvd-online: wait for `ovd devices --json` to list VirtualDevice online',
  'devmode: `ovd vvd devmode enable --json` if Developer Mode is off',
  'doctor, devices, pkg-info, install, launch, logs: the built CLI with --json',
  'vvd-stop: stop the Virtual Device if this run started it (unless --keep-vvd)',
  'fixtures: lay out the recordings when the SDK major.minor is new (or --record)',
  'sanitize + leak-check: replace host details, fail and drop the output on a leak',
  'summary: write summary.md and result.json'
]

function parseArgs(argv) {
  const options = {
    out: join(root, '.work', 'nightly'),
    dryRun: false,
    selfTest: false,
    keepVvd: false,
    record: false,
    project: undefined
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--self-test') options.selfTest = true
    else if (arg === '--keep-vvd') options.keepVvd = true
    else if (arg === '--record') options.record = true
    else if (arg === '--out' || arg === '--project') {
      const value = argv[++i]
      if (!value) usage(`${arg} needs a value`)
      options[arg.slice(2)] = resolve(value)
    } else usage(`unknown option ${arg}`)
  }
  return options
}

function usage(message) {
  console.error(`nightly-sdk-check: ${message}`)
  console.error(
    'usage: node scripts/nightly-sdk-check.mjs [--out <dir>] [--dry-run] [--keep-vvd] [--project <dir>] [--record] [--self-test]'
  )
  process.exit(2)
}

// ---------------------------------------------------------------------------------------------
// Running commands

let current
// Children run in their own process group, so a timeout or Ctrl+C can stop the whole chain
// (`vega exec vda` runs about seven processes; ARCHITECTURE §8).
function run(file, args, { cwd = root, env = process.env, timeoutMs = 120_000 } = {}) {
  return new Promise((done) => {
    const started = Date.now()
    const child = spawn(file, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    current = child
    let stdout = ''
    let stderr = ''
    let timedOut = false
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timer = setTimeout(() => {
      timedOut = true
      killGroup(child.pid, 'SIGTERM')
      setTimeout(() => killGroup(child.pid, 'SIGKILL'), 5_000).unref()
    }, timeoutMs)
    function finish(exit, error) {
      clearTimeout(timer)
      current = undefined
      done({ stdout, stderr, exit, timedOut, error, ms: Date.now() - started })
    }
    child.on('error', (error) => finish(-1, error.message))
    child.on('close', (code, signal) => finish(code ?? (signal ? 128 : -1)))
  })
}

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch {
    // The group is gone already.
  }
}

// ---------------------------------------------------------------------------------------------
// SDK version and fixtures

function parseSdkVersion(stdout) {
  return {
    sdk: /Active SDK Version:\s*(\S+)/.exec(stdout)?.[1],
    cli: /Vega CLI Version:\s*(\S+)/.exec(stdout)?.[1]
  }
}

function majorMinor(version) {
  return /^(\d+)\.(\d+)/
    .exec(version ?? '')
    ?.slice(1, 3)
    .join('.')
}

function newestFixtures() {
  const versions = readdirSync(join(root, 'fixtures')).filter((name) => /^\d+\.\d+$/.test(name))
  const key = (version) => version.split('.').map(Number)
  versions.sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1])
  return versions.at(-1)
}

// ---------------------------------------------------------------------------------------------
// The recording shim

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

// A POSIX sh shim at OVD_VEGA (core checks it before PATH) records exactly the SDK calls core
// runs: argv one per line, stdout and stderr through `tee` so streams still flow live, and the
// real exit code. The real CLI runs in the background so a SIGTERM to the shim alone (a core
// timeout) reaches it too; a signal to the group reaches everything anyway.
function writeShim(shimDir, recordDir, realVega) {
  mkdirSync(shimDir, { recursive: true })
  const shim = join(shimDir, 'vega')
  writeFileSync(
    shim,
    `#!/bin/sh
# Written by scripts/nightly-sdk-check.mjs: records each Vega CLI call, then passes it through.
real=${shellQuote(realVega)}
dir=${shellQuote(recordDir)}
mkdir -p "$dir"
# A mkdir lock numbers the calls in order: \`ovd logs\` runs its stream next to other calls.
while ! mkdir "$dir/.lock" 2>/dev/null; do sleep 0.1; done
n=$(($(cat "$dir/.count" 2>/dev/null || echo 0) + 1))
echo "$n" > "$dir/.count"
rmdir "$dir/.lock"
id=$(printf '%03d' "$n")
printf '%s\\n' "$@" > "$dir/$id.cmd"
out="$dir/$id.stdout.fifo"
err="$dir/$id.stderr.fifo"
mkfifo "$out" "$err"
tee "$dir/$id.stdout" < "$out" &
tout=$!
tee "$dir/$id.stderr" < "$err" >&2 &
terr=$!
"$real" "$@" > "$out" 2> "$err" &
child=$!
trap 'kill -TERM "$child" 2>/dev/null' TERM INT HUP
wait "$child"
code=$?
# A trapped signal interrupts wait; wait again for the real exit code.
while kill -0 "$child" 2>/dev/null; do
  wait "$child"
  code=$?
done
wait "$tout" "$terr"
rm -f "$out" "$err"
echo "$code" > "$dir/$id.exit"
exit "$code"
`
  )
  chmodSync(shim, 0o755)
  return shim
}

function readRecordings(recordDir) {
  if (!existsSync(recordDir)) return []
  return readdirSync(recordDir)
    .filter((name) => /^\d+\.cmd$/.test(name))
    .sort()
    .map((name) => {
      const id = name.slice(0, -'.cmd'.length)
      const read = (ext) => {
        const file = join(recordDir, `${id}.${ext}`)
        return existsSync(file) ? readFileSync(file, 'utf8') : ''
      }
      const exit = read('exit').trim()
      return {
        id,
        args: read('cmd').replace(/\n$/, '').split('\n'),
        stdout: read('stdout'),
        stderr: read('stderr'),
        exit: exit === '' ? undefined : Number(exit)
      }
    })
}

// ---------------------------------------------------------------------------------------------
// Fixture layout

// Name a recording the way fixtures/README.md names tools: `vega-device-info`, `vda-devices`,
// `vlcm-list`, `vpt-info`.
function toolName(args) {
  const words = (list, max) => {
    const picked = []
    for (const word of list) {
      if (picked.length === max || !/^[a-z][a-z0-9_-]*$/.test(word)) break
      picked.push(word)
    }
    return picked
  }
  const dropTargets = (list) => {
    const rest = []
    for (let i = 0; i < list.length; i++) {
      if (list[i] === '-s' || list[i] === '-c') i++
      else rest.push(list[i])
    }
    return rest
  }
  if (args[0] === '--version') return 'vega-version'
  if (args[0] === 'exec' && args[1]) {
    const rest = dropTargets(args.slice(2))
    if (args[1] === 'vda' && rest[0] === 'shell') {
      const command = rest.slice(1)
      if (DEVICE_TOOLS.has(command[0])) return words(command, 3).join('-')
      return 'vda-shell'
    }
    return [args[1], ...words(rest, 2)].join('-')
  }
  return ['vega', ...words(args, 3)].join('-') || 'vega'
}

function isJson(text) {
  if (text.trim() === '') return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

function displayCommand(args) {
  return ['vega', ...args.map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : shellQuote(arg)))]
    .join(' ')
    .replaceAll('|', '\\|')
}

function deviceOf(args, hostArch) {
  const target = args.includes('emulator-5554') || args.includes(VVD_ID)
  return target ? `Virtual Device (${hostArch})` : '—'
}

function layoutFixtures(recordings, fixturesDir, { version, sdk, date, hostArch }) {
  const seen = new Set()
  const rows = []
  let n = 0
  for (const recording of recordings) {
    // The same call with the same answer (status polls) is one fixture.
    const key = JSON.stringify([recording.args, recording.stdout, recording.stderr, recording.exit])
    if (seen.has(key)) continue
    seen.add(key)
    const tool = toolName(recording.args)
    const name = `virtual-device-nightly-${String(++n).padStart(3, '0')}`
    const dir = join(fixturesDir, version, tool)
    mkdirSync(dir, { recursive: true })
    const files = []
    if (recording.stdout !== '' || recording.stderr === '') {
      const file = `${name}.${isJson(recording.stdout) ? 'json' : 'txt'}`
      writeFileSync(join(dir, file), recording.stdout)
      files.push(`${tool}/${file}`)
    }
    if (recording.stderr !== '') {
      writeFileSync(join(dir, `${name}.stderr.txt`), recording.stderr)
      files.push(`${tool}/${name}.stderr.txt`)
    }
    const exit = recording.exit === undefined ? 'no exit code (stopped)' : `exit ${recording.exit}`
    rows.push(
      `| ${files.map((file) => `\`${file}\``).join(', ')} | \`${displayCommand(recording.args)}\` (${exit}) | ${deviceOf(recording.args, hostArch)} | ${date} |`
    )
  }
  writeFileSync(
    join(fixturesDir, version, 'README.md'),
    [
      `# SDK ${version} fixtures (nightly recording)`,
      '',
      `Recorded by \`scripts/nightly-sdk-check.mjs\` with Vega SDK ${sdk.sdk} and Vega CLI ${sdk.cli} on ${process.platform} (${hostArch}).`,
      'Rename each file to its case, check the sanitizing, then move it to `fixtures/` (fixtures/README.md).',
      '',
      '| File | Command | Device | Date |',
      '| --- | --- | --- | --- |',
      ...rows,
      ''
    ].join('\n')
  )
  return rows.length
}

// ---------------------------------------------------------------------------------------------
// Sanitizing and the leak check

// Lookarounds keep parts of longer dotted or colon-separated strings out: a 5-part version,
// or the colon-hex md5 and signature dumps `vpm info` prints.
const OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)'
const IPV4 = new RegExp(`(?<![\\d.])${OCTET}(?:\\.${OCTET}){3}(?![\\d]|\\.\\d)`, 'g')
// Global unicast only (2000::/3), with a full first group, so times such as 16:01:44 never match.
const IPV6 = /(?<![0-9a-f:])[23][0-9a-f]{3}(?::[0-9a-f]{0,4}){2,7}(?![0-9a-f:])/gi
// The last line of a wrapped colon-hex dump can be 6 bytes long: not a MAC.
const MAC =
  /(?<![0-9a-f:])(?<!(?:[0-9a-f]{2}:){5}[0-9a-f]{2}\s+)[0-9a-f]{2}(?::[0-9a-f]{2}){5}(?![0-9a-f:])/gi
// A TLD of letters keeps npm specifiers such as react@18.2.0 out.
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\b/gi
const APP_ID_PATTERN = /\b(?:com|org|net|io|tv|me|dev|app)\.[a-z0-9_]+(?:\.[a-z0-9_]+)+\b/g

function keepIpv4(ip) {
  const [a, b, c] = ip.split('.').map(Number)
  if (a === 127 || a === 0 || a === 255) return true
  return (
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
}

// The sanitizer and the leak check treat the same values as safe, so a value one keeps the
// other doesn't flag, and a value one should replace the other catches.
function keepIpv6(ip) {
  return /^2001:0?db8:/i.test(ip)
}

function keepMac(mac) {
  return mac === '00:00:00:00:00:00' || mac.startsWith('02:00:00:00:00:')
}

function keepEmail(email) {
  return /@example\.(com|org|net)$/i.test(email)
}

// `localhost` names no machine, and replacing it would break loopback URLs.
function usableHost(host) {
  return host === 'localhost' || host.startsWith('localhost.') ? '' : host
}

// This machine's identity; the self-test passes a fake one.
function hostIdentity() {
  return { home: homedir(), user: userInfo().username, host: hostname() }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wordPattern(text) {
  return new RegExp(`(?<![\\w-])${escapeRegExp(text)}(?![\\w-])`, 'g')
}

function listFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true })
    .map((name) => join(dir, name))
    .filter((file) => statSync(file).isFile())
}

// Real paths too: macOS reports /var/folders/… as /private/var/folders/….
function pathVariants(path) {
  const variants = new Set([path])
  try {
    variants.add(realpathSync(path))
  } catch {
    // Already removed.
  }
  return [...variants].sort((a, b) => b.length - a.length)
}

function createSanitizer({ paths, devices, token, identity = hostIdentity() }) {
  const host = usableHost(identity.host)
  const user = identity.user
  const replacements = []
  for (const [path, placeholder] of paths) {
    for (const variant of pathVariants(path)) replacements.push([variant, placeholder])
  }
  for (const variant of pathVariants(identity.home)) replacements.push([variant, '/home/user'])
  if (token) replacements.push([token, '<emulator-console-token>'])
  // Longest first, so a serial inside an `IP:port` ID or a longer name is replaced whole.
  for (const device of devices) {
    if (device.serial) replacements.push([device.serial, device.fakeSerial])
    if (device.id && device.id !== device.serial) replacements.push([device.id, device.fakeSerial])
    if (device.name) replacements.push([device.name, device.fakeName])
  }
  replacements.sort((a, b) => b[0].length - a[0].length)
  const words = []
  if (host) words.push([host, 'host.example'])
  const shortHost = host.split('.')[0]
  if (shortHost.length >= 3 && shortHost !== host) words.push([shortHost, 'host'])
  if (user.length >= 3 && user !== 'user') words.push([user, 'user'])
  const ips = new Map()
  const macs = new Map()
  let v6 = 0
  const v6s = new Map()

  return function sanitize(text) {
    let out = text
    for (const [from, to] of replacements) out = out.replaceAll(from, to)
    for (const [from, to] of words) out = out.replace(wordPattern(from), to)
    out = out.replace(IPV4, (ip) => {
      if (keepIpv4(ip)) return ip
      if (!ips.has(ip)) ips.set(ip, `192.0.2.${10 + ips.size}`)
      return ips.get(ip)
    })
    out = out.replace(IPV6, (ip) => {
      if (keepIpv6(ip)) return ip
      if (!v6s.has(ip)) v6s.set(ip, `2001:db8::${(++v6).toString(16)}`)
      return v6s.get(ip)
    })
    out = out.replace(MAC, (mac) => {
      if (keepMac(mac)) return mac
      if (!macs.has(mac)) {
        macs.set(mac, `02:00:00:00:00:${(macs.size + 1).toString(16).padStart(2, '0')}`)
      }
      return macs.get(mac)
    })
    out = out.replace(EMAIL, (email) => (keepEmail(email) ? email : 'user@example.com'))
    return out
  }
}

function sanitizeTree(dir, sanitize) {
  for (const file of listFiles(dir)) {
    const text = readFileSync(file, 'utf8')
    const clean = sanitize(text)
    if (clean !== text) writeFileSync(file, clean)
  }
}

// Every value that must not leave this machine. Hits are reported by file name, never by value.
function leakCheck(dir, { devices, token, identity = hostIdentity() }) {
  const needles = []
  const user = identity.user
  if (user.length >= 3 && user !== 'user') needles.push(wordPattern(user))
  for (const variant of pathVariants(identity.home)) {
    if (variant !== '/home/user') needles.push(new RegExp(escapeRegExp(variant)))
  }
  const host = usableHost(identity.host)
  if (host) needles.push(wordPattern(host))
  const shortHost = host.split('.')[0]
  if (shortHost.length >= 3 && shortHost !== host) needles.push(wordPattern(shortHost))
  if (token) needles.push(new RegExp(escapeRegExp(token)))
  for (const device of devices) {
    for (const value of [device.serial, device.id, device.name]) {
      if (value) needles.push(new RegExp(escapeRegExp(value)))
    }
  }
  const hits = []
  for (const file of listFiles(dir)) {
    const text = readFileSync(file, 'utf8')
    const patternLeak = [
      [IPV4, keepIpv4],
      [IPV6, keepIpv6],
      [MAC, keepMac],
      [EMAIL, keepEmail]
    ].some(([pattern, keep]) => [...text.matchAll(pattern)].some(([value]) => !keep(value)))
    if (patternLeak || needles.some((needle) => needle.test(text))) hits.push(relative(dir, file))
    for (const needle of needles) needle.lastIndex = 0
  }
  return hits
}

function flaggedAppIds(dir) {
  const ids = new Set()
  for (const file of listFiles(dir)) {
    for (const [id] of readFileSync(file, 'utf8').matchAll(APP_ID_PATTERN)) {
      if (!/^com\.(example|amazon)\./.test(id)) ids.add(id)
    }
  }
  return [...ids].sort()
}

// ---------------------------------------------------------------------------------------------
// Checks of the CLI's --json output

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function vvdOnline(doc) {
  return doc?.devices?.some((device) => device.id === VVD_ID && device.status === 'online')
}

function findKey(value, key) {
  if (value === null || typeof value !== 'object') return undefined
  if (key in value) return value[key]
  for (const child of Object.values(value)) {
    const found = findKey(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

function hostArch() {
  if (process.arch === 'x64') return 'x86_64'
  if (process.arch === 'arm64') return 'aarch64'
  return process.arch
}

function findVpkg(project, arch) {
  const dir = join(project, 'build', `${arch}-debug`)
  if (!existsSync(dir)) return undefined
  const file = readdirSync(dir).find((name) => name.endsWith('.vpkg'))
  return file ? join(dir, file) : undefined
}

// ---------------------------------------------------------------------------------------------
// The run

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) return selfTest()
  if (options.dryRun) {
    console.log(`nightly-sdk-check (dry run): output in ${relative(root, options.out) || '.'}`)
    for (const [index, step] of STEPS.entries()) console.log(`  ${index + 1}. ${step}`)
    return 0
  }

  const out = options.out
  const recordDir = join(out, 'recordings')
  const ovdDir = join(out, 'ovd')
  const fixturesDir = join(out, 'fixtures')
  // Only what this script writes is cleared, so a wrong --out can't delete anything else.
  for (const name of ['recordings', 'ovd', 'fixtures', 'shim', 'summary.md', 'result.json']) {
    rmSync(join(out, name), { recursive: true, force: true })
  }
  mkdirSync(ovdDir, { recursive: true })

  const results = []
  const devices = new Map()
  const ovdHome = mkdtempSync(join(tmpdir(), 'ovd-nightly-home-'))
  const workDir = mkdtempSync(join(tmpdir(), 'ovd-nightly-project-'))
  const date = new Date().toISOString().slice(0, 10)
  const arch = hostArch()
  let startedVvd = false
  let vega
  let realVega
  let sdk = {}
  let fixturesVersion
  let sdkVersion

  function record(step, ok, detail, ms) {
    results.push({ step, ok, detail, ms })
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${step} (${(ms / 1000).toFixed(1)} s) ${detail}`)
  }

  // Non-VVD devices any `ovd devices` lists get sample serials and names (ADR 0016).
  function collectDevices(doc) {
    for (const device of doc?.devices ?? []) {
      if (device.kind === 'vvd' || device.id === VVD_ID) continue
      const key = device.serial ?? device.id
      if (!key || devices.has(key)) continue
      const n = devices.size + 1
      devices.set(key, {
        id: device.id,
        serial: device.serial,
        name: device.name && !SAMPLE_NAMES.includes(device.name) ? device.name : undefined,
        fakeSerial: `G070${String(n).padStart(12, '0')}`,
        fakeName: SAMPLE_NAMES[(n - 1) % SAMPLE_NAMES.length]
      })
    }
  }

  function ovdEnv() {
    return { ...process.env, OVD_VEGA: vega, OVD_HOME: ovdHome }
  }

  async function ovd(step, args, check, timeoutMs = 120_000) {
    const result = await run(process.execPath, [cli, ...args], { env: ovdEnv(), timeoutMs })
    writeFileSync(join(ovdDir, `${step}.stdout`), result.stdout)
    writeFileSync(join(ovdDir, `${step}.stderr`), result.stderr)
    writeFileSync(join(ovdDir, `${step}.exit`), `${result.exit}\n`)
    if (result.timedOut) {
      record(step, false, `timed out after ${timeoutMs / 1000} s`, result.ms)
      return result
    }
    const failure = check(result)
    record(step, failure === undefined, failure ?? `exit ${result.exit}`, result.ms)
    return result
  }

  function okDoc(result) {
    const doc = parseJson(result.stdout)
    if (!doc) return [undefined, `exit ${result.exit}, stdout is not one JSON document`]
    if (doc.ok !== true) return [doc, `exit ${result.exit}, ${doc.error?.code ?? 'ok is not true'}`]
    return [doc, undefined]
  }

  // Ctrl+C, or GitHub cancelling the run: stop what runs, then sanitize and leak-check as a
  // normal end does (finish() is synchronous), so raw recordings never stay in the output.
  let stopping = false
  function onSignal(signal) {
    if (stopping) return
    stopping = true
    if (current) {
      killGroup(current.pid, 'SIGTERM')
      // Give the shim's `tee`s a moment to flush and exit before the files are rewritten.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000)
      killGroup(current.pid, 'SIGKILL')
    }
    results.push({ step: 'interrupted', ok: false, detail: signal, ms: 0 })
    // Sanitize first: a runner that cancels a step kills it a few seconds after the signal.
    try {
      finish()
    } catch {
      // If sanitizing fails, drop the raw output rather than leave it for the upload.
      for (const name of ['recordings', 'ovd', 'fixtures', 'shim']) {
        rmSync(join(out, name), { recursive: true, force: true })
      }
    }
    // Then stop the Virtual Device with the real CLI, so no raw recording lands after it.
    if (startedVvd && !options.keepVvd && realVega) {
      const stop = spawnSync(realVega, ['virtual-device', 'stop'], {
        stdio: 'ignore',
        timeout: 60_000
      })
      console.log(`vvd-stop after ${signal}: exit ${stop.status}`)
    }
    process.exit(signal === 'SIGINT' ? 130 : 143)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  try {
    // a. The Vega CLI and the SDK version.
    realVega = process.env.OVD_REAL_VEGA ?? join(homedir(), 'vega', 'bin', 'vega')
    if (!existsSync(realVega)) {
      record('sdk-version', false, 'no Vega CLI at ~/vega/bin/vega (or OVD_REAL_VEGA)', 0)
      return finish()
    }
    if (!existsSync(cli)) {
      record('sdk-version', false, 'no built CLI: run pnpm --filter @ovd/cli build', 0)
      return finish()
    }
    // b. Every `vega` call from here on, the script's own included, goes through the shim.
    vega = writeShim(join(out, 'shim'), recordDir, realVega)
    const version = await run(vega, ['--version'])
    sdk = parseSdkVersion(version.stdout)
    sdkVersion = majorMinor(sdk.sdk)
    fixturesVersion = newestFixtures()
    record(
      'sdk-version',
      version.exit === 0 && sdkVersion !== undefined,
      `SDK ${sdk.sdk ?? 'unknown'}, Vega CLI ${sdk.cli ?? 'unknown'}, fixtures ${fixturesVersion}`,
      version.ms
    )

    // d. The throwaway project, outside the repo.
    let project = options.project
    if (!project) {
      project = join(workDir, 'hellovega')
      const steps = [
        [
          'project-generate',
          vega,
          [
            'project',
            'generate',
            '-t',
            'helloWorld',
            '-n',
            'hellovega',
            '--packageId',
            APP_ID,
            '-o',
            project
          ],
          workDir,
          180_000
        ],
        ['project-npm-install', 'npm', ['install', '--no-audit', '--no-fund'], project, 900_000],
        ['project-build', 'npm', ['run', 'build:debug'], project, 900_000]
      ]
      for (const [step, file, args, cwd, timeoutMs] of steps) {
        const result = await run(file, args, { cwd, timeoutMs })
        writeFileSync(join(ovdDir, `${step}.log`), `${result.stdout}\n${result.stderr}`)
        const ok = result.exit === 0 && !result.timedOut
        record(step, ok, result.timedOut ? 'timed out' : `exit ${result.exit}`, result.ms)
        if (!ok) break
      }
    }
    const vpkg = findVpkg(project, arch)

    // c. The Virtual Device: reuse a running one, else start it headless.
    const status = await run(vega, ['virtual-device', 'status'])
    const running = parseJson(status.stdout)?.running === true
    if (running) {
      record('vvd-start', true, 'already running; left running', status.ms)
    } else {
      const args = ['virtual-device', 'start', '--no-gui', '--timeout', '300']
      // GitHub's runners have no GPU; the SDK accepts --no-gl-accel on Linux only.
      if (process.platform === 'linux') args.push('--no-gl-accel')
      const start = await run(vega, args, { timeoutMs: 330_000 })
      startedVvd = true
      // `start` can exit 0 without starting (ARCHITECTURE §8): the status decides.
      const after = await run(vega, ['virtual-device', 'status'])
      const ok = parseJson(after.stdout)?.running === true
      record('vvd-start', ok, `exit ${start.exit}, running ${ok}`, start.ms + after.ms)
    }

    // VDA can drop the Virtual Device for a few seconds after start (ARCHITECTURE §8).
    const waitStarted = Date.now()
    let online = false
    while (!online && Date.now() - waitStarted < 120_000) {
      const result = await run(process.execPath, [cli, 'devices', '--json'], { env: ovdEnv() })
      const doc = parseJson(result.stdout)
      collectDevices(doc)
      online = vvdOnline(doc) === true
      if (!online) await new Promise((wait) => setTimeout(wait, 3_000))
    }
    record(
      'vvd-online',
      online,
      online ? 'VirtualDevice online' : 'not online after 120 s',
      Date.now() - waitStarted
    )

    if (online) {
      // `vega device info` prints empty fields for a moment after boot (ARCHITECTURE §8), so
      // Developer Mode is read until it is a boolean.
      const infoStarted = Date.now()
      let developerMode
      while (typeof developerMode !== 'boolean' && Date.now() - infoStarted < 60_000) {
        const info = await run(process.execPath, [cli, 'device', 'info', VVD_ID, '--json'], {
          env: ovdEnv()
        })
        developerMode = findKey(parseJson(info.stdout), 'developerMode')
        if (typeof developerMode !== 'boolean') await new Promise((wait) => setTimeout(wait, 3_000))
      }
      if (developerMode === false) {
        await ovd('devmode', ['vvd', 'devmode', 'enable', '--json'], (result) => okDoc(result)[1])
      } else {
        const ms = Date.now() - infoStarted
        record('devmode', developerMode === true, `developerMode ${developerMode}`, ms)
      }
    }

    // e. The first-release commands, each with an explicit check.
    const target = ['--json', '--device', VVD_ID]
    await ovd('doctor', ['doctor', ...target], (result) => {
      const [doc, failure] = okDoc(result)
      if (failure) return failure
      const check = doc.checks?.find((entry) => entry.id === 'sdk')
      return check?.status === 'ok' ? undefined : `sdk check ${check?.status ?? 'missing'}`
    })
    await ovd('devices', ['devices', ...target], (result) => {
      const [doc, failure] = okDoc(result)
      collectDevices(doc)
      if (failure) return failure
      return vvdOnline(doc) ? undefined : 'VirtualDevice not listed online'
    })
    if (!vpkg) {
      for (const step of ['pkg-info', 'install', 'launch']) {
        record(step, false, `skipped: no build/${arch}-debug/*.vpkg`, 0)
      }
    } else {
      await ovd('pkg-info', ['pkg', 'info', vpkg, ...target], (result) => {
        const [doc, failure] = okDoc(result)
        if (failure) return failure
        if (doc.package?.id !== APP_ID) return `package id ${doc.package?.id}`
        // The helloWorld template is pure JS, so its package is `any` (ADR 0008).
        const architecture = doc.package?.architecture
        return architecture === arch || architecture === 'any'
          ? undefined
          : `architecture ${doc.package?.architecture}`
      })
      await ovd(
        'install',
        ['install', vpkg, ...target],
        (result) => {
          const [doc, failure] = okDoc(result)
          if (failure) return failure
          return doc.install?.installed === true && doc.install?.package?.id === APP_ID
            ? undefined
            : 'not installed'
        },
        300_000
      )
      // ARCHITECTURE §8: `launch-app` accepts the package ID and starts the main component.
      await ovd(
        'launch',
        ['apps', 'launch', APP_ID, ...target],
        (result) => {
          const [doc, failure] = okDoc(result)
          if (failure) return failure
          return doc.launch?.verified === true ? undefined : `not verified: ${doc.launch?.reason}`
        },
        240_000
      )
    }
    // A duration in --until means that long ago, so the end is a date-time 20 s from now. No
    // --app: the helloWorld template logs nothing from JS, so its filter keeps no lines.
    const until = new Date(Date.now() + 20_000).toISOString()
    await ovd(
      'logs',
      ['logs', '--until', until, ...target],
      (result) => {
        if (result.exit !== 0) return `exit ${result.exit}`
        const lines = result.stdout.split('\n').filter((line) => line.trim() !== '')
        const docs = lines.map(parseJson)
        if (docs.some((doc) => doc === undefined)) return 'a line is not JSON'
        const entries = docs.filter((doc) => typeof doc.message === 'string' && !doc.ovd)
        return entries.length > 0 ? undefined : 'no log entries in 20 s'
      },
      120_000
    )
  } catch (error) {
    // A script bug still stops the Virtual Device and writes the summary.
    record('script', false, error instanceof Error ? error.message : String(error), 0)
  } finally {
    if (startedVvd && !options.keepVvd) {
      const stop = await run(vega, ['virtual-device', 'stop'], { timeoutMs: 120_000 })
      record('vvd-stop', stop.exit === 0, `exit ${stop.exit}`, stop.ms)
    }
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
  return finish()

  function finish() {
    const activity = join(ovdHome, 'activity.jsonl')
    if (existsSync(activity)) copyFileSync(activity, join(ovdDir, 'activity.jsonl'))
    // The shim holds the real CLI's path and is no use in the artifact.
    rmSync(join(out, 'shim'), { recursive: true, force: true })
    // The shim's call counter and lock are bookkeeping, not recordings.
    for (const name of existsSync(recordDir) ? readdirSync(recordDir) : []) {
      if (name.startsWith('.')) rmSync(join(recordDir, name), { recursive: true, force: true })
    }

    // g. Recordings become fixtures only for an SDK major.minor with no folder yet.
    let fixtures = 0
    const newVersion = sdkVersion !== undefined && sdkVersion !== fixturesVersion
    if (sdkVersion !== undefined && (newVersion || options.record)) {
      fixtures = layoutFixtures(readRecordings(recordDir), fixturesDir, {
        version: sdkVersion,
        sdk,
        date,
        hostArch: arch
      })
    }

    // f. Sanitize, then f2. check nothing slipped through.
    const token = existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, 'utf8').trim() : ''
    const known = { devices: [...devices.values()], token: token.length >= 8 ? token : undefined }
    const sanitize = createSanitizer({
      paths: [
        [workDir, '/tmp/hellovega-work'],
        [ovdHome, '/tmp/ovd-home'],
        [root, '/home/user/ovd']
      ],
      ...known
    })
    sanitizeTree(out, sanitize)
    const leaks = leakCheck(out, known)
    if (leaks.length > 0) {
      for (const name of ['recordings', 'ovd', 'fixtures']) {
        rmSync(join(out, name), { recursive: true, force: true })
      }
      results.push({ step: 'leak-check', ok: false, detail: `${leaks.length} file(s)`, ms: 0 })
      console.log(
        `FAIL leak-check: ${leaks.length} file(s) still held host details; output removed`
      )
    } else {
      results.push({ step: 'leak-check', ok: true, detail: 'no host details left', ms: 0 })
    }
    const appIds = leaks.length > 0 ? [] : flaggedAppIds(out)

    // h. The summary.
    const ok = results.every((result) => result.ok)
    const result = {
      ok,
      date,
      host: { platform: process.platform, arch },
      sdk: {
        version: sdk.sdk,
        cli: sdk.cli,
        majorMinor: sdkVersion,
        newestFixtures: fixturesVersion
      },
      // A tripped leak check removed the layout with the rest, so nothing is left to curate.
      fixtures:
        leaks.length > 0
          ? { recorded: 0, folder: null, dropped: true, laidOut: fixtures }
          : { recorded: fixtures, folder: fixtures > 0 ? `fixtures/${sdkVersion}` : null },
      steps: results,
      leaks,
      appIdsToCurate: appIds
    }
    writeFileSync(join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
    writeFileSync(join(out, 'summary.md'), summaryMarkdown(result))
    rmSync(ovdHome, { recursive: true, force: true })
    rmSync(workDir, { recursive: true, force: true })
    console.log(`nightly-sdk-check: ${ok ? 'ok' : 'failed'} (${relative(root, out) || out})`)
    return ok ? 0 : 1
  }
}

function summaryMarkdown(result) {
  const lines = [
    `## Nightly SDK check: ${result.ok ? 'passed' : 'failed'}`,
    '',
    `Vega SDK ${result.sdk.version ?? 'unknown'} (Vega CLI ${result.sdk.cli ?? 'unknown'}) on ${result.host.platform} ${result.host.arch}, ${result.date}. Newest fixtures: \`fixtures/${result.sdk.newestFixtures}\`.`,
    '',
    '| Step | Result | Time | Detail |',
    '| --- | --- | --- | --- |',
    ...result.steps.map(
      (step) =>
        `| ${step.step} | ${step.ok ? 'pass' : '**fail**'} | ${(step.ms / 1000).toFixed(1)} s | ${String(step.detail).replaceAll('|', '\\|')} |`
    ),
    ''
  ]
  if (result.fixtures.recorded > 0) {
    lines.push(
      `${result.fixtures.recorded} recordings laid out in \`${result.fixtures.folder}\` (artifact) for curation.`,
      ''
    )
  }
  if (result.fixtures.dropped && result.fixtures.laidOut > 0) {
    lines.push(
      `${result.fixtures.laidOut} recordings were laid out as fixtures, then dropped by the leak check.`,
      ''
    )
  }
  if (result.leaks.length > 0) {
    lines.push(
      `Leak check: ${result.leaks.length} file(s) held host details after sanitizing and were removed: ${result.leaks.map((file) => `\`${file}\``).join(', ')}.`,
      ''
    )
  }
  if (result.appIdsToCurate.length > 0) {
    lines.push(
      `App IDs to curate before committing fixtures: ${result.appIdsToCurate.map((id) => `\`${id}\``).join(', ')}.`,
      ''
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------------------------
// Self-test: the pure parts on made-up input. Vitest is the maintainer's gate to extend, so the
// script carries its own check, and CI runs it before the SDK install.

function selfTest() {
  const scratch = mkdtempSync(join(tmpdir(), 'ovd-nightly-self-test-'))
  let failures = 0
  function check(name, body) {
    try {
      body()
      console.log(`ok   ${name}`)
    } catch (error) {
      failures++
      console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  try {
    check('parseSdkVersion and majorMinor', () => {
      const sdk = parseSdkVersion('Active SDK Version: 0.24.12112\nVega CLI Version: 1.4.5\n')
      assert.deepEqual(sdk, { sdk: '0.24.12112', cli: '1.4.5' })
      assert.equal(majorMinor(sdk.sdk), '0.24')
      assert.equal(majorMinor('2.0.13986'), '2.0')
      assert.equal(majorMinor(undefined), undefined)
      assert.deepEqual(parseSdkVersion('Unknown arguments'), { sdk: undefined, cli: undefined })
    })

    const names = [
      [['--version'], 'vega-version'],
      [['device', 'info', '--device', 'VirtualDevice'], 'vega-device-info'],
      [['virtual-device', 'start', '--no-gui', '--timeout', '300'], 'vega-virtual-device-start'],
      [['sdk', 'config', 'doctor', '--json'], 'vega-sdk-config-doctor'],
      [['exec', 'vda', 'devices', '-l'], 'vda-devices'],
      [['exec', 'vpt', 'info', '--json', '/tmp/a.vpkg'], 'vpt-info'],
      [
        ['exec', 'vda', '-s', 'emulator-5554', 'shell', 'vlcm', 'list', '--app-id', 'x'],
        'vlcm-list'
      ],
      [
        ['exec', 'vda', '-s', 'e', 'shell', 'vsm', 'developer-mode', 'enable'],
        'vsm-developer-mode-enable'
      ],
      [['exec', 'vda', '-s', 'e', 'shell', 'loggingctl', 'log', '-f'], 'loggingctl-log'],
      [['exec', 'vda', '-s', 'e', 'shell', 'vpm', 'info', 'com.example.hellovega'], 'vpm-info'],
      [['exec', 'vda', '-s', 'e', 'shell', 'echo', 'Zm9v', '|', 'sh'], 'vda-shell']
    ]
    for (const [args, expected] of names) {
      check(`toolName ${args.join(' ')}`, () => assert.equal(toolName(args), expected))
    }

    // A fake machine: its home is a symlink, so the real path is a second spelling of it.
    const realHome = join(scratch, 'real-home')
    mkdirSync(realHome)
    const home = join(scratch, 'home-link')
    symlinkSync(realHome, home)
    const identity = { home, user: 'jdoe', host: 'build-box-7.corp.internal' }
    const token = 'tok3n-SECRET-value-42'
    const devices = [
      {
        id: '10.20.30.40:5555',
        serial: 'G0R1234567890XYZ',
        name: "Jane's TV",
        fakeSerial: 'G070000000000001',
        fakeName: 'Living room stick'
      }
    ]
    const known = { devices, token, identity }
    const raw = [
      `home ${home}/project and ${realpathSync(realHome)}/cache`,
      'user jdoe on build-box-7.corp.internal (build-box-7)',
      'ip 10.1.2.3 and again 10.1.2.3, v6 2a01:4f8:1:2::3, mac aa:bb:cc:dd:ee:ff',
      'mail jane@corp.internal',
      `token ${token}`,
      "stick G0R1234567890XYZ at 10.20.30.40:5555 named Jane's TV"
    ].join('\n')
    const safe = [
      'docs 192.0.2.5 198.51.100.7 203.0.113.9 loopback 127.0.0.1 any 0.0.0.0',
      'versions 1.0.323.0 0.24.12112 1.2.3.4.5 react@18.2.0',
      'v6 2001:db8::7 time 16:01:44.123 mail user@example.com localhost',
      '\t\tba:7b:3f:44:0d:75:99:2d:11:6d:84:e0:a8:91:84:3b',
      '\t\t\t02:30:05:78:30:db',
      'md5: 02:00:00:00:00:01:02:00:00:00:00:02:a7:14:38:77'
    ].join('\n')
    const sanitize = createSanitizer({ paths: [[join(scratch, 'work'), '/tmp/work']], ...known })
    const clean = sanitize(raw)

    check('sanitize replaces host details', () => {
      assert.equal(
        clean,
        [
          'home /home/user/project and /home/user/cache',
          'user user on host.example (host)',
          'ip 192.0.2.10 and again 192.0.2.10, v6 2001:db8::1, mac 02:00:00:00:00:01',
          'mail user@example.com',
          'token <emulator-console-token>',
          'stick G070000000000001 at G070000000000001 named Living room stick'
        ].join('\n')
      )
    })
    check('sanitize keeps sample data, versions and hex dumps', () => {
      assert.equal(sanitize(safe), safe)
    })

    const leakDir = join(scratch, 'leaks')
    mkdirSync(leakDir)
    writeFileSync(join(leakDir, 'clean.txt'), `${clean}\n${safe}`)
    const needles = {
      home: `${home}/x`,
      'real-home': `${realpathSync(realHome)}/x`,
      user: 'by jdoe',
      host: 'on build-box-7.corp.internal',
      'short-host': 'on build-box-7',
      token: `t=${token}`,
      serial: 'G0R1234567890XYZ',
      name: "Jane's TV",
      ipv4: '172.16.4.2',
      ipv6: '2600:1f18::9',
      mac: '3c:22:fb:01:02:03',
      email: 'a.person@corp.internal'
    }
    for (const [name, text] of Object.entries(needles)) {
      writeFileSync(join(leakDir, `${name}.txt`), `before ${text} after\n`)
    }
    check('leakCheck passes sanitized and safe text', () => {
      const hits = leakCheck(leakDir, known)
      assert.ok(!hits.includes('clean.txt'), 'clean.txt flagged')
    })
    for (const name of Object.keys(needles)) {
      check(`leakCheck flags ${name}`, () => {
        assert.ok(leakCheck(leakDir, known).includes(`${name}.txt`), `${name}.txt not flagged`)
      })
    }

    check('layoutFixtures dedupes and names files', () => {
      const recording = (id, stdout) => ({
        id,
        args: ['device', 'info', '--device', 'VirtualDevice'],
        stdout,
        stderr: 'log line\n',
        exit: 0
      })
      const fixtures = join(scratch, 'fixtures')
      const count = layoutFixtures(
        [recording('001', '{"a":1}'), recording('002', '{"a":1}'), recording('003', 'text')],
        fixtures,
        {
          version: '9.9',
          sdk: { sdk: '9.9.1', cli: '9.0.0' },
          date: '2026-11-10',
          hostArch: 'x86_64'
        }
      )
      assert.equal(count, 2)
      const dir = join(fixtures, '9.9', 'vega-device-info')
      assert.deepEqual(readdirSync(dir).sort(), [
        'virtual-device-nightly-001.json',
        'virtual-device-nightly-001.stderr.txt',
        'virtual-device-nightly-002.stderr.txt',
        'virtual-device-nightly-002.txt'
      ])
      const readme = readFileSync(join(fixtures, '9.9', 'README.md'), 'utf8')
      assert.equal(readme.split('\n').filter((line) => line.startsWith('| `')).length, 2)
      assert.match(readme, /Virtual Device \(x86_64\)/)
    })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  console.log(`nightly-sdk-check self-test: ${failures === 0 ? 'ok' : `${failures} failed`}`)
  return failures === 0 ? 0 : 1
}

process.exitCode = await main()
