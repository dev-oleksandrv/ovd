// The `inputd-cli start` console (fixtures/0.24/inputd-cli-console): a welcome, then the prompt
// `inputd-cli > `; each reply is its lines, `\n\r\n`, then the next prompt. No JSON mode, and the
// one-shot form exits 0 even for an invalid key, so success is judged by the reply's text.
export const INPUTD_PROMPT = 'inputd-cli > '
const REPLY_END = `\n\r\n${INPUTD_PROMPT}`
const WELCOME_END = `\n${INPUTD_PROMPT}`

// The welcome is complete at its first prompt.
export function inputdWelcomeDone(buffer: string): boolean {
  return buffer.endsWith(WELCOME_END)
}

// A reply is complete only at `\n\r\n` and the prompt, so a text that itself contains
// `inputd-cli > ` (echoed in `Injecting Text: …`) doesn't end it early.
export function inputdReplyDone(buffer: string): boolean {
  return buffer.endsWith(REPLY_END)
}

// The reply's own lines, without the closing `\n\r\n` and prompt.
export function inputdReplyBody(buffer: string): string {
  return inputdReplyDone(buffer) ? buffer.slice(0, -REPLY_END.length) : buffer
}

export type InputdReply = { ok: true } | { ok: false; message: string }

const PRESSED = /^Injecting Button Press As Driver: (\S+) State: short$/
const TYPED = /^Injecting Text: /
const BAD_ARGUMENTS = /^send_text provided with an invalid number of arguments\.?$/

// `button_press <name>`: ok when inputd-cli says it injected that key.
export function parseInputdPress(reply: string, key: string): InputdReply {
  const lines = replyLines(reply)
  if (lines.some((line) => PRESSED.exec(line)?.[1] === key)) return { ok: true }
  // `invalid button value: [KEY_NOPE]`: the reason, which only names the key.
  const reason = lines.filter((line) => !/^\d+$/.test(line)).at(-1)
  return { ok: false, message: reason ?? 'inputd-cli gave no answer' }
}

// `send_text "<text>"`: ok when inputd-cli says it injected text. A failure's message is a known
// reason or a fixed one, never the reply itself: the text may be a password.
export function parseInputdText(reply: string): InputdReply {
  const lines = replyLines(reply)
  if (lines.some((line) => TYPED.test(line))) return { ok: true }
  if (lines.some((line) => BAD_ARGUMENTS.test(line))) {
    return { ok: false, message: 'send_text provided with an invalid number of arguments' }
  }
  return { ok: false, message: 'inputd-cli didn’t accept the text' }
}

function replyLines(reply: string): string[] {
  return inputdReplyBody(reply)
    .split('\n')
    .map((line) => line.replace(/\r$/, '').trim())
    .filter((line) => line !== '')
}
