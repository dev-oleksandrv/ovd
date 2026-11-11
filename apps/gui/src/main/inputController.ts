import {
  isOvdError,
  toErrorJson,
  type ErrorJson,
  type InputSession,
  type Ovd,
  type PressResult,
  type TextResult
} from '@ovd/core'
import type { InputOutcome, InputSent, InputState } from '../preload/api'
import { inputKey, inputText } from './guards'

export interface InputController {
  // Opens the session for `device`, or returns the one already open (or opening) for it.
  open(device: unknown): Promise<InputState>
  press(key: unknown): Promise<InputOutcome>
  text(text: unknown): Promise<InputOutcome>
  state(): InputState
  // Main heard of a new target: a session for another device closes (the screen opens the next).
  targetChanged(target: string | null): void
  // On quit and when the window closes: the stick's console exits.
  close(): Promise<void>
}

// The input session panel keeps the last 50 sends.
export const SENT_LIMIT = 50

// `ovd input press <key> --device <id>`.
export function pressCli(key: string, device: string): string {
  return `ovd input press ${key} --device ${device}`
}

// `ovd input text "<text>" --device <id>`, quoted so it pastes into a shell as it was typed: in
// double quotes with `\`, `"`, `$` and backticks escaped, or in single quotes when it has a `!`
// (history expansion in double quotes). `--` keeps a text that starts with `-` from being a flag.
export function textCli(text: string, device: string): string {
  const quoted = text.includes('!')
    ? `'${text.replaceAll("'", "'\\''")}'`
    : `"${text.replace(/[\\"$`]/g, (c) => `\\${c}`)}"`
  return `ovd input text ${text.startsWith('-') ? '-- ' : ''}${quoted} --device ${device}`
}

function unexpected(error: unknown): ErrorJson {
  return {
    code: 'INPUT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    hint: 'This is a bug in OVD. Please report it with what you did'
  }
}

const noSession: ErrorJson = {
  code: 'INPUT_FAILED',
  message: 'The remote isn’t connected yet',
  hint: 'Wait for the session to open, or press Retry'
}

// One input session at a time, for the target (Stage 4.2): a stick's `inputd-cli` console stays
// open between presses (ADR 0010). Main owns it, so it closes with the app.
export function createInputController(deps: {
  input: Pick<Ovd['input'], 'session'>
  send: (state: InputState) => void
  now?: () => Date
}): InputController {
  const now = deps.now ?? (() => new Date())
  let state: InputState = { status: 'idle', target: null, backend: null, sent: [] }
  let session: InputSession | undefined
  let device: string | null = null
  let opening: Promise<InputState> | undefined
  // Bumped by every open and close: an open that finishes in another generation is dropped.
  let generation = 0

  const set = (next: InputState) => {
    state = next
    deps.send(state)
  }

  // Drops the current session (and any open in flight) and waits for it to close.
  const closeCurrent = async () => {
    generation++
    await closeSession()
  }
  const closeSession = async () => {
    const old = session
    session = undefined
    opening = undefined
    device = null
    await old?.close().catch(() => undefined)
  }

  const record = (entry: InputSent) => {
    set({ ...state, sent: [entry, ...state.sent].slice(0, SENT_LIMIT) })
  }

  async function sendWith(
    kind: InputSent['kind'],
    label: string,
    cli: (device: string) => string,
    run: (s: InputSession) => Promise<PressResult | TextResult>
  ): Promise<InputOutcome> {
    const time = now().toISOString()
    const current = session
    const id = state.target?.id ?? device ?? ''
    const entry = (fields: Pick<InputSent, 'ok' | 'error'>): InputSent => ({
      time,
      kind,
      label,
      cli: cli(id),
      ...fields
    })
    if (!current || state.status !== 'ready') {
      const sent = entry({ ok: false, error: noSession })
      record(sent)
      return { ok: false, sent }
    }
    try {
      const result = await run(current)
      const sent = entry({ ok: true })
      if (session === current) record(sent)
      return { ok: true, sent, result }
    } catch (error) {
      const sent = entry({
        ok: false,
        error: isOvdError(error) ? toErrorJson(error) : unexpected(error)
      })
      if (session === current) record(sent)
      return { ok: false, sent }
    }
  }

  return {
    async open(value) {
      const id = inputText(value, 'device')
      if (device === id && (state.status === 'ready' || state.status === 'opening')) {
        return opening ?? state
      }
      const keep = state.target?.id === id ? state.sent : []
      const gen = ++generation
      await closeSession()
      // Closed, or another open started, while the old session closed.
      if (gen !== generation) return state
      device = id
      set({ status: 'opening', target: { id, name: id }, backend: null, sent: keep })
      const started = deps.input.session(id).then(
        async (s): Promise<InputState> => {
          if (gen !== generation) {
            await s.close()
            return state
          }
          session = s
          set({ status: 'ready', target: s.target, backend: s.backend, sent: state.sent })
          return state
        },
        (error: unknown): InputState => {
          if (gen === generation) {
            set({
              ...state,
              status: 'error',
              error: isOvdError(error) ? toErrorJson(error) : unexpected(error)
            })
          }
          return state
        }
      )
      opening = started
      const result = await started
      if (opening === started) opening = undefined
      return result
    },

    press(value) {
      const key = inputKey(value)
      return sendWith(
        'press',
        key,
        (d) => pressCli(key, d),
        (s) => s.press([key])
      )
    },

    text(value) {
      const text = inputText(value, 'text', { allowEmpty: true })
      return sendWith(
        'text',
        `"${text}"`,
        (d) => textCli(text, d),
        (s) => s.text(text)
      )
    },

    state: () => state,

    targetChanged(target) {
      // No target at all (the device is likely rebooting) keeps the session, as Logs does.
      if (target === null || device === null || target === device) return
      void closeCurrent().then(() => set({ status: 'idle', target: null, backend: null, sent: [] }))
    },

    close: closeCurrent
  }
}
