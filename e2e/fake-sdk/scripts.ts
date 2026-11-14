// The device scripts of launch verification, as the fake recognizes them. The recordings fix
// their text (fixtures/0.24/README.md, rows `log-capture/started.txt`,
// `log-capture/stick-crashed.txt` and `loggingctl-vault-acr/virtual-device-crashed.txt`); only
// the capture's `timeout` seconds, file and pid, the package, the crash pid and the vault index
// vary. Written with `String.raw` and escaped as a whole, so a script that lost a backslash
// (`'\[pid\]'`, `\$`, `<\/`) matches nothing and the fake doesn't answer it. e2e tests use
// `decodeScript` to assert the calls.

const START_TEXT = String.raw`f=$(mktemp) || exit 1
timeout <seconds> loggingctl log -f -o short_precise > "$f" 2>&1 &
echo "$f $!"
`
const STOP_TEXT = String.raw`pkill -P <pid>; kill <pid> 2>/dev/null
grep -e <package> -e '\[<crash pid>\]' -e 'PID=<crash pid>' <file> | tail -n 200
rm -f <file>
`
const ACR_TEXT = String.raw`loggingctl vault --cat SYSTEM_TOMBSTONE <index> | sed -n -e "1,/^\$/p" -e "/<non_native_stack_trace>/,/<\/non_native_stack_trace>/p"
`

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The text of a `shell echo <base64> | base64 -d | sh` call, or null.
export function decodeScript(sub: string): string | null {
  const m = /^shell echo ([A-Za-z0-9+/=]+) \| base64 -d \| sh$/.exec(sub)
  return m?.[1] === undefined ? null : Buffer.from(m[1], 'base64').toString()
}

export const CAPTURE_START = new RegExp(`^${escape(START_TEXT).replace('<seconds>', '(\\d+)')}$`)

// The stop of the capture `file` with `timeout` pid `pid`: captures the package and the crash pid.
export function captureStop(file: string, pid: number): RegExp {
  const source = escape(STOP_TEXT)
    .replaceAll('<pid>', String(pid))
    .replaceAll('<file>', escape(file))
    .replace('<package>', '([A-Za-z0-9._-]+)')
    .replace('<crash pid>', '(\\d+)')
    .replace('<crash pid>', '\\2')
  return new RegExp(`^${source}$`)
}

// The bounded read of a crash report: captures the vault index.
export const ACR = new RegExp(`^${escape(ACR_TEXT).replace('<index>', '(\\d+)')}$`)

// The full-ACR pull script (fixtures/0.24/README.md, row `loggingctl-vault-acr/pull-script-ok.txt`):
// the report goes to a private temp file that `vda pull` then copies. The README writes it on one
// line with `; `; core may send it as lines, so both spellings are folded into the one-line form
// before matching. Captures the vault index.
const PULL_TEXT = String.raw`umask 077; d=$(mktemp -d /tmp/ovd-acr.XXXXXX) || exit 1; f="$d/report.acr"; loggingctl vault --cat SYSTEM_TOMBSTONE <index> > "$f"; echo "$f"; wc -c < "$f"; ls -ld "$d" "$f"`
const ACR_PULL = new RegExp(`^${escape(PULL_TEXT).replace('<index>', '(\\d+)')}$`)

// The vault index of a full-ACR pull script, or null for any other script.
export function acrPullIndex(script: string): number | null {
  const oneLine = script.replace(/;?\n/g, '; ').replace(/;\s*$/, '').trim()
  const m = ACR_PULL.exec(oneLine)
  return m?.[1] === undefined ? null : Number(m[1])
}
