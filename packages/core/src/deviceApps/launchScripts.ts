import type { LogCapture } from '../adapters/parseLogCapture.js'
import type { AppId } from './appId.js'

// The device scripts of launch verification. Their text is the text the fixtures were recorded
// with (fixtures/0.24/README.md, rows `log-capture/started.txt`, `log-capture/stick-crashed.txt`
// and `loggingctl-vault-acr/virtual-device-crashed.txt`), one line per ` / ` of the README; the
// README's `\|` is Markdown for `|`. Only the capture's `timeout` seconds, file and pid, the
// package, the crash pid and the vault index vary.

// The lines the stop script keeps (`tail -n`).
export const CAPTURE_TAIL_LINES = 200

// `vega exec vda shell` re-wraps its command in a host `sh -c "…"`, which breaks `$` and quotes
// (ARCHITECTURE §8), so a script travels base64-encoded, as `ALL_PACKAGES` in `deviceApps.ts`.
export function deviceScript(text: string): string {
  return `echo ${Buffer.from(text).toString('base64')} | base64 -d | sh`
}

// A bounded capture in the background: `timeout` ends `loggingctl` even when OVD never stops it.
// Prints the capture file and the `timeout` pid.
export function captureStartScript(seconds: number): string {
  integer(seconds, 'seconds')
  return (
    'f=$(mktemp) || exit 1\n' +
    `timeout ${seconds} loggingctl log -f -o short_precise > "$f" 2>&1 &\n` +
    'echo "$f $!"\n'
  )
}

// Stops the capture and prints its lines about the app and the crash. `kill <pid>` alone leaves
// `loggingctl` running as an orphan, so its children go first. The device text has a backslash
// before each bracket, so grep matches the bracketed pid, not any one of its digits.
export function captureStopScript(capture: LogCapture, packageId: AppId, crashPid: number): string {
  integer(capture.pid, 'capture pid')
  integer(crashPid, 'crash pid')
  return (
    `pkill -P ${capture.pid}; kill ${capture.pid} 2>/dev/null\n` +
    `grep -e ${packageId} -e '\\[${crashPid}\\]' -e 'PID=${crashPid}' ${capture.file} | tail -n ${CAPTURE_TAIL_LINES}\n` +
    `rm -f ${capture.file}\n`
  )
}

// The ACR's header and its JS stack: the whole report is about 350 KB (meminfo, minidump, core
// dump), so `sed` keeps only the lines up to the first blank one and the stack section.
export function acrScript(index: number): string {
  integer(index, 'vault index')
  return `loggingctl vault --cat SYSTEM_TOMBSTONE ${index} | sed -n -e "1,/^\\$/p" -e "/<non_native_stack_trace>/,/<\\/non_native_stack_trace>/p"\n`
}

// A programming error: these numbers come from validated output.
function integer(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new Error(`launchScripts: ${what} isn’t an integer: ${n}`)
}
