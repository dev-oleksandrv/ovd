import { describe, expect, test } from 'vitest'
import { assertAppId } from '../../src/deviceApps/appId.js'
import {
  acrScript,
  captureStartScript,
  captureStopScript,
  deviceScript
} from '../../src/deviceApps/launchScripts.js'

// The recorded texts (fixtures/0.24/README.md): `String.raw`, so no backslash gets lost.
const START = String.raw`f=$(mktemp) || exit 1
timeout 60 loggingctl log -f -o short_precise > "$f" 2>&1 &
echo "$f $!"
`
const STOP = String.raw`pkill -P 2056; kill 2056 2>/dev/null
grep -e com.example.player -e '\[3200\]' -e 'PID=3200' /tmp/tmp.XXXXHeBy6l | tail -n 200
rm -f /tmp/tmp.XXXXHeBy6l
`
const ACR = String.raw`loggingctl vault --cat SYSTEM_TOMBSTONE 37 | sed -n -e "1,/^\$/p" -e "/<non_native_stack_trace>/,/<\/non_native_stack_trace>/p"
`
const capture = { file: '/tmp/tmp.XXXXHeBy6l', pid: 2056 }
const player = assertAppId('com.example.player', { from: 'argument' })

describe('launch scripts', () => {
  test('the capture start is the recorded text', () => {
    expect(captureStartScript(60)).toBe(START)
  })

  test('the capture stop is the recorded text, with the backslashes before the brackets', () => {
    const script = captureStopScript(capture, player, 3200)
    expect(script).toBe(STOP)
    expect(script.includes(String.raw`'\[3200\]'`)).toBe(true)
  })

  test('the ACR read is the recorded text, with its escapes', () => {
    const script = acrScript(37)
    expect(script).toBe(ACR)
    expect(script.includes(String.raw`/^\$/p`)).toBe(true)
    expect(script.includes(String.raw`<\/non_native_stack_trace>`)).toBe(true)
  })

  test.each([
    ['a crash pid', () => captureStopScript(capture, player, 1.5)],
    ['a capture pid', () => captureStopScript({ ...capture, pid: Number.NaN }, player, 0)],
    ['an index', () => acrScript(Number.POSITIVE_INFINITY)],
    ['seconds', () => captureStartScript(0.5)]
  ])('%s that isn’t an integer throws', (_name, build) => {
    expect(build).toThrow(/isn’t an integer/)
  })

  test('deviceScript travels base64-encoded', () => {
    const script = deviceScript(STOP)
    const m = /^echo ([A-Za-z0-9+/=]+) \| base64 -d \| sh$/.exec(script)
    expect(Buffer.from(m?.[1] ?? '', 'base64').toString()).toBe(STOP)
  })
})
