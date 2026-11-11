// @vitest-environment node
import { OvdError, type InputSession, type PressResult, type TextResult } from '@ovd/core'
import { describe, expect, test, vi } from 'vitest'
import {
  createInputController,
  pressCli,
  SENT_LIMIT,
  textCli
} from '../../src/main/inputController'
import type { InputState } from '../../src/preload/api'

const STICK = 'G070000000000001'
const stickTarget = { id: STICK, name: 'Living room stick' }
const TIME = '2026-11-11T10:00:00.000Z'

function fakeSession(target = stickTarget, backend: InputSession['backend'] = 'inputd-cli') {
  const session = {
    target,
    backend,
    press: vi.fn(async (keys: string[]): Promise<PressResult> => ({
      target,
      backend,
      keys: keys as PressResult['keys']
    })),
    text: vi.fn(async (text: string): Promise<TextResult> => ({
      target,
      backend,
      text,
      length: text.length
    })),
    close: vi.fn(async () => undefined)
  }
  return session
}

function setup(opts: { session?: (device: string) => Promise<InputSession> } = {}) {
  const sent: InputState[] = []
  const sessions: ReturnType<typeof fakeSession>[] = []
  const session = vi.fn(
    opts.session ??
      (async (device: string) => {
        const s = fakeSession(
          device === 'VirtualDevice' ? { id: device, name: 'Vega Virtual Device' } : stickTarget,
          device === 'VirtualDevice' ? 'grpc' : 'inputd-cli'
        )
        sessions.push(s)
        return s
      })
  )
  const controller = createInputController({
    input: { session },
    send: (s) => sent.push(s),
    now: () => new Date(TIME)
  })
  return { controller, sent, session, sessions }
}

describe('CLI echo', () => {
  test.each([
    ['hello world', 'ovd input text "hello world" --device X'],
    ['say "hi" $HOME `x` \\', 'ovd input text "say \\"hi\\" \\$HOME \\`x\\` \\\\" --device X'],
    ["Hi! it's", "ovd input text 'Hi! it'\\''s' --device X"],
    ['-x', 'ovd input text -- "-x" --device X']
  ])('text %j → %s', (text, cli) => {
    expect(textCli(text, 'X')).toBe(cli)
  })

  test('press', () => {
    expect(pressCli('play-pause', '192.0.2.42:5555')).toBe(
      'ovd input press play-pause --device 192.0.2.42:5555'
    )
  })
})

describe('createInputController', () => {
  test('open: opening, then ready with the target and backend', async () => {
    const { controller, sent, session } = setup()
    const state = await controller.open(STICK)
    expect(session).toHaveBeenCalledWith(STICK)
    expect(sent.map((s) => s.status)).toEqual(['opening', 'ready'])
    expect(state).toEqual({ status: 'ready', target: stickTarget, backend: 'inputd-cli', sent: [] })
  })

  test('open again for the same device reuses the session', async () => {
    const { controller, session } = setup()
    await controller.open(STICK)
    await controller.open(STICK)
    expect(session).toHaveBeenCalledTimes(1)
  })

  test('another device closes the old session first', async () => {
    const { controller, sessions } = setup()
    await controller.open(STICK)
    const state = await controller.open('VirtualDevice')
    expect(sessions[0]?.close).toHaveBeenCalled()
    expect(state).toMatchObject({ status: 'ready', backend: 'grpc' })
  })

  test('a session that can’t open is an error state; open retries it', async () => {
    let fail = true
    const { controller } = setup({
      session: async () => {
        if (fail) throw new OvdError('INPUT_FAILED', 'inputd-cli didn’t answer', 'Check it')
        return fakeSession()
      }
    })
    expect(await controller.open(STICK)).toMatchObject({
      status: 'error',
      error: { code: 'INPUT_FAILED', message: 'inputd-cli didn’t answer', hint: 'Check it' }
    })
    fail = false
    expect(await controller.open(STICK)).toMatchObject({ status: 'ready' })
  })

  test('a press goes through the session and is listed with its CLI echo', async () => {
    const { controller, sessions } = setup()
    await controller.open(STICK)
    const outcome = await controller.press('down')
    expect(sessions[0]?.press).toHaveBeenCalledWith(['down'])
    const entry = {
      time: TIME,
      kind: 'press',
      label: 'down',
      cli: `ovd input press down --device ${STICK}`,
      ok: true
    }
    expect(outcome).toEqual({
      ok: true,
      sent: entry,
      result: { target: stickTarget, backend: 'inputd-cli', keys: ['down'] }
    })
    expect(controller.state().sent).toEqual([entry])
  })

  test('a text is listed with its quoted CLI echo; a failure carries the error', async () => {
    const { controller, sessions } = setup()
    await controller.open(STICK)
    sessions[0]?.text.mockRejectedValueOnce(
      new OvdError('TARGET_OFFLINE', 'Living room stick is offline', 'Reconnect it')
    )
    const outcome = await controller.text('hi there')
    expect(outcome).toEqual({
      ok: false,
      sent: {
        time: TIME,
        kind: 'text',
        label: '"hi there"',
        cli: `ovd input text "hi there" --device ${STICK}`,
        ok: false,
        error: {
          code: 'TARGET_OFFLINE',
          message: 'Living room stick is offline',
          hint: 'Reconnect it'
        }
      }
    })
  })

  test('the list keeps the last 50, newest first', async () => {
    const { controller } = setup()
    await controller.open(STICK)
    for (let i = 0; i < SENT_LIMIT + 5; i++) await controller.press(i % 2 ? 'up' : 'down')
    const { sent } = controller.state()
    expect(sent).toHaveLength(SENT_LIMIT)
    expect(sent[0]?.label).toBe('down')
  })

  test('without an open session a press fails without reaching core', async () => {
    const { controller, session } = setup()
    expect(await controller.press('up')).toMatchObject({
      ok: false,
      sent: { error: { code: 'INPUT_FAILED' } }
    })
    expect(session).not.toHaveBeenCalled()
  })

  test.each([['nope'], [42], [undefined], ['UP']])(
    'a key that isn’t a remote key (%j) is refused',
    async (key) => {
      const { controller } = setup()
      await controller.open(STICK)
      expect(() => controller.press(key)).toThrow(TypeError)
    }
  )

  test.each([[42], [null], ['x'.repeat(10_001)]])('text payload %#: refused', async (text) => {
    const { controller } = setup()
    await controller.open(STICK)
    expect(() => controller.text(text)).toThrow(TypeError)
  })

  test('an empty text reaches core, which answers INVALID_TEXT', async () => {
    const { controller, sessions } = setup()
    await controller.open(STICK)
    await controller.text('')
    expect(sessions[0]?.text).toHaveBeenCalledWith('')
  })

  test('a new target closes the session and goes idle; no target keeps it', async () => {
    const { controller, sessions } = setup()
    await controller.open(STICK)
    controller.targetChanged(null)
    controller.targetChanged(STICK)
    expect(sessions[0]?.close).not.toHaveBeenCalled()
    controller.targetChanged('VirtualDevice')
    await vi.waitFor(() => expect(controller.state().status).toBe('idle'))
    expect(sessions[0]?.close).toHaveBeenCalled()
  })

  test('close closes the session; an open in flight is closed when it arrives', async () => {
    let resolve: (s: InputSession) => void = () => undefined
    const late = fakeSession()
    const { controller } = setup({ session: () => new Promise((r) => (resolve = r)) })
    const opened = controller.open(STICK)
    // Once the open is waiting for core's session.
    await new Promise((r) => setTimeout(r, 0))
    await controller.close()
    resolve(late)
    await opened
    expect(late.close).toHaveBeenCalled()
  })
})
