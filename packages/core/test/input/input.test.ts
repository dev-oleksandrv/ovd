import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  createActivityLog,
  createInput,
  createSdkLocator,
  OvdError,
  type ActivityEntry,
  type Device,
  type Devices,
  type KeyEvent
} from '../../src/index.js'
import { FakeRunner, FakeStream } from '../support/fakeRunner.js'
import { InputdStream, type InputdStreamOptions } from '../support/fakeInputd.js'
import { fixture } from '../support/fixtures.js'

const STICK_CONSOLE = 'vega exec vda -s G070000000000001 shell inputd-cli start'

const stick: Device = {
  id: 'G070000000000001',
  vdaSerial: 'G070000000000001',
  serial: 'G070000000000001',
  name: 'Living room stick',
  kind: 'stick',
  connection: 'usb',
  status: 'online',
  isTarget: true,
  saved: false
}

const vvd: Device = {
  id: 'VirtualDevice',
  vdaSerial: 'emulator-5554',
  serial: 'VirtualDevice',
  name: 'Vega Virtual Device',
  kind: 'vvd',
  connection: 'local',
  status: 'online',
  isTarget: false,
  saved: false
}

const down = (keyCode: number): KeyEvent => ({ keyCode, eventType: 'down' })
const up = (keyCode: number): KeyEvent => ({ keyCode, eventType: 'up' })
const tap = (keyCode: number) => [down(keyCode), up(keyCode)]
const SHIFT = 42

let home: string

beforeEach(async () => {
  home = join(await mkdtemp(join(tmpdir(), 'ovd-input-')), 'ovd')
})

type Send = (events: KeyEvent[]) => void | Promise<void>

interface Setup {
  // The target and the device list; `get` answers from `now` once set.
  target?: Device | null
  now?: Device | OvdError
  consoles?: (InputdStream | FakeStream)[]
  console?: InputdStreamOptions
  // What the emulator does with each `sendKeys`, in order; the last repeats. Default: accepts.
  sends?: Send[]
  ensure?: () => Promise<{ port: number }>
}

function setup(opts: Setup = {}) {
  const consoles = opts.consoles ?? [new InputdStream(opts.console)]
  const runner = new FakeRunner({ [STICK_CONSOLE]: consoles })
  const sdk = createSdkLocator(async () => ({
    vegaPath: '/sdk/vega',
    cli: 'manager',
    sdkVersion: '0.24.12112',
    cliVersion: '1.4.5'
  }))
  const target = opts.target === undefined ? stick : opts.target
  const missing = () => Promise.reject(new Error('unexpected'))
  const devices: Devices = {
    list: missing,
    currentTarget: async (override) => {
      if (override !== undefined && override !== target?.id) {
        throw new OvdError('DEVICE_NOT_FOUND', `No device ${override}`, 'Check ovd devices')
      }
      return target ? { device: target, source: 'remembered' } : null
    },
    get: async () => {
      const now = opts.now ?? target
      if (now instanceof OvdError) throw now
      if (!now) throw new Error('no device')
      return now
    },
    rename: missing,
    setTarget: missing,
    invalidate: () => undefined
  }
  const sent: { serial: string; events: KeyEvent[] }[] = []
  const sends = opts.sends ?? [() => undefined]
  const ensured: Device[] = []
  const input = createInput({
    runner,
    sdk,
    devices,
    activity: createActivityLog({ home, surface: 'cli' }),
    emulator: {
      async sendKeys(serial, events) {
        sent.push({ serial, events })
        const send = sends[Math.min(sent.length, sends.length) - 1]
        await send?.(events)
      }
    },
    vvd: {
      async ensureGrpc(device) {
        ensured.push(device)
        return opts.ensure ? opts.ensure() : { port: 8554 }
      }
    }
  })
  return { input, runner, consoles, sent, ensured }
}

async function activity(): Promise<Omit<ActivityEntry, 'time' | 'surface'>[]> {
  const text = await readFile(join(home, 'activity.jsonl'), 'utf8').catch(() => '')
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const entry: Partial<ActivityEntry> = JSON.parse(line) as ActivityEntry
      delete entry.time
      delete entry.surface
      return entry as Omit<ActivityEntry, 'time' | 'surface'>
    })
}

const off = () => {
  throw new OvdError('VVD_GRPC_FAILED', 'Emulator gRPC is off', 'Turn it on', { off: true })
}
const broken = () => {
  throw new OvdError('VVD_GRPC_FAILED', 'Emulator gRPC sendKey failed', 'Turn it on', {
    grpcStatus: '13'
  })
}

describe('Input.press on a stick (inputd-cli)', () => {
  test('presses each key in one console, then exits it; one activity entry', async () => {
    const { input, runner, consoles } = setup()
    const result = await input.press(['down', 'ok'])
    expect(result).toEqual({
      target: { id: stick.id, name: 'Living room stick' },
      backend: 'inputd-cli',
      keys: ['down', 'ok']
    })
    expect(runner.calls.map((c) => c.display)).toEqual([STICK_CONSOLE])
    expect((consoles[0] as InputdStream).lines).toEqual([
      'button_press KEY_DOWN',
      'button_press KEY_ENTER',
      'exit'
    ])
    expect(await activity()).toEqual([
      {
        action: 'input.press',
        target: stick.id,
        args: { keys: 'down,ok', backend: 'inputd-cli' },
        result: 'ok'
      }
    ])
  })

  test('--device picks the device; an unknown one is DEVICE_NOT_FOUND', async () => {
    const { input } = setup()
    await expect(input.press(['up'], { device: stick.id })).resolves.toMatchObject({
      keys: ['up']
    })
    await expect(input.press(['up'], { device: 'NOPE' })).rejects.toMatchObject({
      code: 'DEVICE_NOT_FOUND'
    })
  })

  test('a key inputd-cli refuses is INPUT_FAILED with its reason', async () => {
    const { input } = setup({
      console: { answer: () => fixture('0.24/inputd-cli-console/invalid-button.txt') }
    })
    await expect(input.press(['menu'])).rejects.toMatchObject({
      code: 'INPUT_FAILED',
      message: 'inputd-cli didn’t press menu: invalid button value: [KEY_NOPE]'
    })
    expect((await activity()).map((a) => [a.action, a.result, a.errorCode])).toEqual([
      ['input.press', 'error', 'INPUT_FAILED']
    ])
  })

  test('a stick VDA doesn’t list: TARGET_OFFLINE', async () => {
    const gone = new FakeStream()
    const { input } = setup({ consoles: [gone] })
    const pressed = input.press(['up'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    gone.end(1, fixture('0.24/vda-shell/stick-usb-not-found.stderr.txt'))
    await expect(pressed).rejects.toMatchObject({
      code: 'TARGET_OFFLINE',
      message: 'Living room stick is offline'
    })
  })

  test('the console ends mid-command and the stick is gone: TARGET_OFFLINE', async () => {
    const stream = new InputdStream({ answer: () => null })
    const { input } = setup({ consoles: [stream], now: { ...stick, status: 'offline' } })
    const pressed = input.press(['up'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    stream.end(0)
    await expect(pressed).rejects.toMatchObject({ code: 'TARGET_OFFLINE' })
  })

  test('the console ends mid-command while the stick is still online: INPUT_FAILED', async () => {
    const stream = new InputdStream({ answer: () => null })
    const { input } = setup({ consoles: [stream] })
    const pressed = input.press(['up'])
    await new Promise((resolve) => setTimeout(resolve, 0))
    stream.end(0)
    await expect(pressed).rejects.toMatchObject({
      code: 'INPUT_FAILED',
      message: 'The inputd-cli session on Living room stick ended',
      details: { reason: 'ended' }
    })
  })

  test('Ctrl+C stops the console and rejects with an AbortError, which isn’t logged', async () => {
    const stream = new InputdStream({ answer: () => null })
    const controller = new AbortController()
    const { input } = setup({ consoles: [stream] })
    const pressed = input.press(['up'], { signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    await expect(pressed).rejects.toMatchObject({ name: 'AbortError' })
    expect(stream.stopped).toBe(true)
    expect(await activity()).toEqual([])
  })
})

describe('Input.text on a stick', () => {
  test('quotes the text for send_text, escaping " and \\; only its length is logged', async () => {
    const { input, consoles } = setup()
    const text = 'say "hi" \\o/'
    expect(await input.text(text)).toEqual({
      target: { id: stick.id, name: 'Living room stick' },
      backend: 'inputd-cli',
      text,
      length: 12
    })
    expect((consoles[0] as InputdStream).lines[0]).toBe('send_text "say \\"hi\\" \\\\o/"')
    const entries = await activity()
    expect(entries).toEqual([
      {
        action: 'input.text',
        target: stick.id,
        args: { length: '12', backend: 'inputd-cli' },
        result: 'ok'
      }
    ])
    expect(await readFile(join(home, 'activity.jsonl'), 'utf8')).not.toContain('say')
  })

  test('UTF-8 passes through to a stick', async () => {
    const { input, consoles } = setup()
    await input.text('café ☕')
    expect((consoles[0] as InputdStream).lines[0]).toBe('send_text "café ☕"')
  })

  test('a refused text is INPUT_FAILED, and neither the error nor the log has the text', async () => {
    const { input } = setup({
      console: { answer: () => fixture('0.24/inputd-cli-console/send-text-unquoted-space.txt') }
    })
    const error: unknown = await input.text('hunter2 secret').catch((e: unknown) => e)
    expect(error).toMatchObject({
      code: 'INPUT_FAILED',
      message:
        'inputd-cli didn’t type the text: send_text provided with an invalid number of arguments'
    })
    expect(JSON.stringify(error)).not.toContain('hunter2')
    expect((error as Error).message).not.toContain('hunter2')
    expect(await readFile(join(home, 'activity.jsonl'), 'utf8')).not.toContain('hunter2')
  })
})

describe('Input on the Virtual Device (gRPC)', () => {
  test('a press is evdev down and up per key, in one sendKeys call', async () => {
    const { input, sent, runner } = setup({ target: vvd })
    expect(await input.press(['down', 'ok', 'back'])).toEqual({
      target: { id: 'VirtualDevice', name: 'Vega Virtual Device' },
      backend: 'grpc',
      keys: ['down', 'ok', 'back']
    })
    expect(sent).toEqual([
      { serial: 'emulator-5554', events: [...tap(108), ...tap(96), ...tap(158)] }
    ])
    expect(runner.calls).toEqual([])
    expect((await activity())[0]).toMatchObject({
      action: 'input.press',
      args: { keys: 'down,ok,back', backend: 'grpc' },
      result: 'ok'
    })
  })

  test('text is one key per character, capitals and symbols wrapped in shift', async () => {
    const { input, sent } = setup({ target: vvd })
    await input.text('Hi!')
    expect(sent[0]?.events).toEqual([
      down(SHIFT),
      ...tap(35),
      up(SHIFT),
      ...tap(23),
      down(SHIFT),
      ...tap(2),
      up(SHIFT)
    ])
  })

  test('Home is KEY_UNSUPPORTED before anything is sent, also among other keys', async () => {
    const { input, sent } = setup({ target: vvd })
    await expect(input.press(['down', 'home'])).rejects.toMatchObject({
      code: 'KEY_UNSUPPORTED',
      message: 'Home can’t be sent to the Virtual Device'
    })
    expect(sent).toEqual([])
    expect(await activity()).toEqual([
      {
        action: 'input.press',
        target: 'VirtualDevice',
        args: { keys: 'down,home', backend: 'grpc' },
        result: 'error',
        errorCode: 'KEY_UNSUPPORTED'
      }
    ])
  })

  test('non-ASCII text is INVALID_TEXT on the Virtual Device, before anything is sent', async () => {
    const { input, sent } = setup({ target: vvd })
    await expect(input.text('café')).rejects.toMatchObject({ code: 'INVALID_TEXT' })
    expect(sent).toEqual([])
    expect((await activity())[0]).toMatchObject({
      target: 'VirtualDevice',
      errorCode: 'INVALID_TEXT'
    })
  })

  test('gRPC off: turned on once, then the keys are sent again', async () => {
    const { input, sent, ensured } = setup({ target: vvd, sends: [off, () => undefined] })
    await input.press(['up'])
    expect(ensured).toEqual([vvd])
    expect(sent.map((s) => s.events)).toEqual([tap(103), tap(103)])
  })

  test('turning it on fails: VVD_GRPC_FAILED, and nothing is sent again', async () => {
    const { input, sent } = setup({
      target: vvd,
      sends: [off],
      ensure: async () => {
        throw new OvdError('VVD_GRPC_FAILED', '~/.emulator_console_auth_token is missing', 'x')
      }
    })
    await expect(input.press(['up'])).rejects.toMatchObject({ code: 'VVD_GRPC_FAILED' })
    expect(sent).toHaveLength(1)
  })

  test('a failure mid-text still releases shift', async () => {
    const { input, sent } = setup({ target: vvd, sends: [broken, () => undefined] })
    await expect(input.text('A')).rejects.toMatchObject({ code: 'VVD_GRPC_FAILED' })
    expect(sent.map((s) => s.events)).toEqual([[down(SHIFT), ...tap(30), up(SHIFT)], [up(SHIFT)]])
  })

  test('stopped meanwhile: TARGET_OFFLINE', async () => {
    const { input } = setup({ target: vvd, sends: [broken], now: { ...vvd, status: 'stopped' } })
    await expect(input.press(['up'])).rejects.toMatchObject({
      code: 'TARGET_OFFLINE',
      message: 'Vega Virtual Device is stopped'
    })
  })
})

describe('validation, before any SDK call', () => {
  test.each([
    [['nope'], 'INVALID_KEY'],
    [['up', 'UP'], 'INVALID_KEY'],
    [[], 'INVALID_KEY']
  ])('press %j: %s, logged with no target', async (keys, code) => {
    const { input, runner } = setup()
    await expect(input.press(keys)).rejects.toMatchObject({ code })
    expect(runner.calls).toEqual([])
    expect(await activity()).toEqual([
      {
        action: 'input.press',
        target: null,
        args: { keys: keys.join(',') },
        result: 'error',
        errorCode: code
      }
    ])
  })

  test.each([
    ['', 'Nothing to type'],
    ['line one\nline two', 'The text has control characters (a newline or tab)'],
    ['a\tb', 'The text has control characters (a newline or tab)'],
    ['x'.repeat(501), 'The text is longer than 500 characters']
  ])('text %j: INVALID_TEXT', async (text, message) => {
    const { input, runner } = setup()
    await expect(input.text(text)).rejects.toMatchObject({ code: 'INVALID_TEXT', message })
    expect(runner.calls).toEqual([])
    expect((await activity())[0]).toMatchObject({
      action: 'input.text',
      target: null,
      args: { length: String([...text].length) },
      errorCode: 'INVALID_TEXT'
    })
  })

  test('500 characters are fine', async () => {
    const { input } = setup()
    await expect(input.text('x'.repeat(500))).resolves.toMatchObject({ length: 500 })
  })

  test('no target: NO_TARGET', async () => {
    const { input } = setup({ target: null })
    await expect(input.press(['up'])).rejects.toMatchObject({ code: 'NO_TARGET' })
    expect((await activity())[0]).toMatchObject({ target: null, errorCode: 'NO_TARGET' })
  })

  test('an offline target: TARGET_OFFLINE, with its ID', async () => {
    const { input, runner } = setup({ target: { ...stick, status: 'offline' } })
    await expect(input.text('hi')).rejects.toMatchObject({ code: 'TARGET_OFFLINE' })
    expect(runner.calls).toEqual([])
    expect((await activity())[0]).toMatchObject({ target: null, errorCode: 'TARGET_OFFLINE' })
  })
})

describe('Input.session', () => {
  test('opens the stick’s console up front and keeps it for every press', async () => {
    const { input, runner, consoles } = setup()
    const session = await input.session()
    expect(runner.calls).toHaveLength(1)
    expect(session).toMatchObject({ backend: 'inputd-cli', target: { id: stick.id } })
    await Promise.all([session.press(['up']), session.text('hi'), session.press(['back'])])
    await session.close()
    expect(runner.calls).toHaveLength(1)
    expect((consoles[0] as InputdStream).lines).toEqual([
      'button_press KEY_UP',
      'send_text "hi"',
      'button_press KEY_BACK',
      'exit'
    ])
    expect((await activity()).map((a) => a.action)).toEqual([
      'input.press',
      'input.text',
      'input.press'
    ])
  })

  test('a console that ended by itself is opened again on the next press', async () => {
    const first = new InputdStream()
    const second = new InputdStream()
    const { input, runner } = setup({ consoles: [first, second] })
    const session = await input.session()
    first.end(0)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await session.press(['up'])
    expect(runner.calls).toHaveLength(2)
    expect(second.lines).toEqual(['button_press KEY_UP'])
    await session.close()
  })

  test('a Virtual Device session opens nothing and says so', async () => {
    const { input, runner } = setup({ target: vvd })
    const session = await input.session()
    expect(session.backend).toBe('grpc')
    expect(runner.calls).toEqual([])
    await session.close()
  })

  test('presses after close fail', async () => {
    const { input } = setup()
    const session = await input.session()
    await session.close()
    await expect(session.press(['up'])).rejects.toMatchObject({ code: 'INPUT_FAILED' })
  })
})
