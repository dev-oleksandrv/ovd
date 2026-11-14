import { OvdError } from '../errors/ovdError.js'

// A pattern longer than this is refused: no log search needs more, and a long pattern is what
// hides a backtracking bomb.
export const MAX_REGEX_CHARS = 512

interface Frame {
  // A quantifier or an alternation somewhere inside the group.
  inner: boolean
}

// A regex runs on the host over device text, and a saved filter makes one reusable, so a
// pattern that can backtrack without bound would stall the log view (`(a+)+$` on a 50-character
// line). The 4096-character slice of `REGEX_SLICE_CHARS` caps the input, not the work. This
// refuses what makes the work exponential, and leaves ordinary searches alone:
// - a group that can repeat (`*`, `+`, `{n,}`, `{n,m}` with m > 1) and holds a quantifier or an
//   alternation: `(a+)+`, `(a*)*`, `(a|aa)+`, `(.*a){3,}`. `(a+)?` and `(ab)+` stay;
// - backreferences and lookbehind, whose cost no static rule bounds;
// - a pattern over MAX_REGEX_CHARS.
// It reads a pattern `new RegExp` already accepted, so it only walks the syntax it needs.
// Chained open-ended repeats (`.*a.*b.*c`) are polynomial, not exponential, and are not refused.
export function assertSafeRegex(pattern: string): void {
  if (pattern.length > MAX_REGEX_CHARS) {
    refuse(`is longer than ${MAX_REGEX_CHARS} characters`, 'Use a shorter expression')
  }
  const stack: Frame[] = [{ inner: false }]
  // The group that just closed, until the next token says whether it is quantified.
  let closed: Frame | undefined
  let i = 0
  while (i < pattern.length) {
    const char = pattern[i]
    const group = closed
    closed = undefined
    if (char === '\\') {
      const next = pattern[i + 1] ?? ''
      if (/[1-9k]/.test(next)) {
        refuse(
          'uses a backreference',
          'Backreferences can make a search very slow; match the text twice instead'
        )
      }
      i += 2
      continue
    }
    if (char === '[') {
      i = endOfClass(pattern, i)
      continue
    }
    if (char === '(') {
      if (pattern.startsWith('(?<=', i) || pattern.startsWith('(?<!', i)) {
        refuse('uses a lookbehind', 'Lookbehind can make a search very slow; drop it')
      }
      stack.push({ inner: false })
      // `?:`, `?=`, `?!` and `?<name>` are group syntax, not a quantifier.
      const prefix = /^\?(?::|=|!|<[A-Za-z_$][\w$]*>)/.exec(pattern.slice(i + 1))
      i += 1 + (prefix ? prefix[0].length : 0)
      continue
    }
    if (char === ')') {
      const frame = stack.length > 1 ? stack.pop() : undefined
      const parent = stack[stack.length - 1]
      if (frame && parent) {
        if (frame.inner) parent.inner = true
        closed = frame
      }
      i++
      continue
    }
    if (char === '|') {
      const top = stack[stack.length - 1]
      if (top) top.inner = true
      i++
      continue
    }
    const quantifier = quantifierAt(pattern, i)
    if (quantifier !== undefined) {
      const top = stack[stack.length - 1]
      if (top) top.inner = true
      if (group?.inner && quantifier.max > 1) {
        refuse(
          'has a repeated group that already repeats inside',
          'A pattern like (a+)+ can take forever on a long line; simplify it'
        )
      }
      i += quantifier.length
      // A lazy `?` after a quantifier changes the match, not the repeat.
      if (pattern[i] === '?') i++
      continue
    }
    i++
  }
}

// How far a class `[...]` reaches from its `[` at `start`: one past its closing `]`.
function endOfClass(pattern: string, start: number): number {
  let i = start + 1
  while (i < pattern.length) {
    if (pattern[i] === '\\') i += 2
    else if (pattern[i] === ']') return i + 1
    else i++
  }
  return pattern.length
}

// The quantifier that starts at `i` (its length and the most it repeats), or undefined.
function quantifierAt(pattern: string, i: number): { length: number; max: number } | undefined {
  const char = pattern[i]
  if (char === '*' || char === '+') return { length: 1, max: Number.POSITIVE_INFINITY }
  if (char === '?') return { length: 1, max: 1 }
  if (char !== '{') return undefined
  const match = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i, i + 24))
  if (!match) return undefined
  const [text = '', exact = '0', comma, upper = ''] = match.slice(0, 4)
  const max = comma === undefined ? Number(exact) : upper === '' ? Infinity : Number(upper)
  return { length: text.length, max }
}

function refuse(problem: string, hint: string): never {
  throw new OvdError('INVALID_LOG_FILTER', `The search expression ${problem}`, hint)
}
