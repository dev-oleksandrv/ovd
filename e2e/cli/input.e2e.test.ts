import { describe, expect, test } from 'vitest'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'
import { ovd } from '../harness/cli.ts'
import { stillRunning } from '../harness/sandbox.ts'
import { createSandbox } from '../harness/vitest.ts'

const CONSOLE = `vega exec vda -s ${STICK_SERIAL} shell inputd-cli start`
const VVD = ['--device', 'VirtualDevice']
const SHIFT = 42

// What the fake emulator saw for each key: its code and down (0) or up (1).
const keys = (calls: { method: string; keyCode?: number; eventType?: number }[]) =>
  calls.filter((c) => c.method === 'sendKey').map((c) => [c.keyCode, c.eventType])
const tap = (code: number) => [
  [code, 0],
  [code, 1]
]

describe('ovd input on a stick (inputd-cli)', () => {
  test('press sends each key through one console, which exits when the command ends', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['input', 'press', 'down', 'ok', '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json()).toEqual({
      ok: true,
      input: {
        target: { id: STICK_SERIAL, name: 'Fire TV stick' },
        backend: 'inputd-cli',
        keys: ['down', 'ok']
      }
    })
    expect(sandbox.calls().filter((c) => c === CONSOLE)).toHaveLength(1)
    expect(sandbox.inputConsole()).toEqual([
      'button_press KEY_DOWN',
      'button_press KEY_ENTER',
      'exit'
    ])
    expect(stillRunning(sandbox.inputConsolePids())).toEqual([])
    expect(sandbox.activity()).toEqual([
      expect.objectContaining({
        surface: 'cli',
        action: 'input.press',
        target: STICK_SERIAL,
        args: { keys: 'down,ok', backend: 'inputd-cli' },
        result: 'ok'
      })
    ])
  })

  test('text is quoted for send_text; the activity log has only its length', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['input', 'text', 'say "hi" now', '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json()).toMatchObject({ input: { text: 'say "hi" now', length: 12 } })
    expect(sandbox.inputConsole()).toEqual(['send_text "say \\"hi\\" now"', 'exit'])
    expect(sandbox.activity()).toEqual([
      expect.objectContaining({
        action: 'input.text',
        args: { length: '12', backend: 'inputd-cli' },
        result: 'ok'
      })
    ])
    expect(JSON.stringify(sandbox.activity())).not.toContain('say')
  })

  test('an unknown key exits 2 before any SDK call, and is logged with no target', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['input', 'press', 'down', 'nope', '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'INVALID_KEY' } })
    expect(sandbox.calls()).toEqual([])
    expect(sandbox.activity()).toEqual([
      expect.objectContaining({
        action: 'input.press',
        target: null,
        result: 'error',
        errorCode: 'INVALID_KEY'
      })
    ])
  })
})

describe('ovd input on the Virtual Device (gRPC)', () => {
  test('press sends evdev down and up per key; OK is KEY_KPENTER', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()
    expect((await ovd(sandbox, ['vvd', 'start'])).exitCode).toBe(0)

    const run = await ovd(sandbox, ['input', 'press', 'down', 'ok', ...VVD, '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json()).toMatchObject({ input: { backend: 'grpc', keys: ['down', 'ok'] } })
    expect(keys(sandbox.grpcCalls())).toEqual([...tap(108), ...tap(96)])
    expect(sandbox.grpcCalls().every((c) => c.method !== 'sendKey' || c.codeType === 1)).toBe(true)
    expect(sandbox.calls().some((c) => c.includes('inputd-cli'))).toBe(false)
  })

  test('text is one key per character, with shift around capitals and symbols', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()
    await ovd(sandbox, ['vvd', 'start'])

    const run = await ovd(sandbox, ['input', 'text', 'Hi!', ...VVD, '--json'])

    expect(run.exitCode).toBe(0)
    expect(keys(sandbox.grpcCalls())).toEqual([
      [SHIFT, 0],
      ...tap(35),
      [SHIFT, 1],
      ...tap(23),
      [SHIFT, 0],
      ...tap(2),
      [SHIFT, 1]
    ])
  })

  test('Home exits 2 with KEY_UNSUPPORTED and nothing is sent, also among other keys', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()
    await ovd(sandbox, ['vvd', 'start'])

    const run = await ovd(sandbox, ['input', 'press', 'down', 'home', ...VVD, '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({
      ok: false,
      error: { code: 'KEY_UNSUPPORTED', message: 'Home can’t be sent to the Virtual Device' }
    })
    expect(keys(sandbox.grpcCalls())).toEqual([])
    expect(sandbox.activity().at(-1)).toMatchObject({
      action: 'input.press',
      target: 'VirtualDevice',
      errorCode: 'KEY_UNSUPPORTED'
    })
  })

  test('gRPC off: the first press turns it on once, then the key arrives', async () => {
    // Running, but not started by OVD: gRPC is off (no discovery file).
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['input', 'press', 'back', ...VVD, '--json'])

    expect(run.exitCode).toBe(0)
    expect(keys(sandbox.grpcCalls())).toEqual(tap(158))
    expect(sandbox.activity().map((a) => [a.action, a.result])).toEqual([
      ['vvd.grpc.enable', 'ok'],
      ['input.press', 'ok']
    ])

    await ovd(sandbox, ['input', 'press', 'back', ...VVD])
    expect(sandbox.activity().filter((a) => a.action === 'vvd.grpc.enable')).toHaveLength(1)
  })

  test('gRPC off and the console token missing: VVD_GRPC_FAILED, exit 1, nothing sent', async () => {
    const sandbox = createSandbox({
      vvd: { running: true, developerMode: true },
      consoleToken: 'missing'
    })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['input', 'press', 'up', ...VVD, '--json'])

    expect(run.exitCode).toBe(1)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'VVD_GRPC_FAILED' } })
    expect(keys(sandbox.grpcCalls())).toEqual([])
    expect(sandbox.activity().map((a) => [a.action, a.errorCode])).toEqual([
      ['vvd.grpc.enable', 'VVD_GRPC_FAILED'],
      ['input.press', 'VVD_GRPC_FAILED']
    ])
  })

  test('a stopped Virtual Device: TARGET_OFFLINE, exit 4', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()

    const run = await ovd(sandbox, ['input', 'press', 'up', ...VVD, '--json'])

    expect(run.exitCode).toBe(4)
    expect(run.json()).toMatchObject({
      ok: false,
      error: { code: 'TARGET_OFFLINE', hint: 'Start it with ovd vvd start' }
    })
    expect(sandbox.grpcCalls()).toEqual([])
  })

  test('non-ASCII text exits 2 with INVALID_TEXT before anything is sent', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['input', 'text', 'café', ...VVD, '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'INVALID_TEXT' } })
    expect(sandbox.grpcCalls()).toEqual([])
  })
})
