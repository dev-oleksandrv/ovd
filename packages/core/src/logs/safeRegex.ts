import { OvdError } from '../errors/ovdError.js'

// A pattern longer than this is refused: no log search needs more, and a long pattern is what
// hides a backtracking bomb.
export const MAX_REGEX_CHARS = 512
// A `{n}`, `{n,}` or `{n,m}` count above this is refused: `(a+){1000000,}` is no search.
export const MAX_REPEAT_COUNT = 1000
// A repeat that can cover a long stretch of the line: `*`, `+`, `{n,}`, or `{n,m}` with m above
// MAX_SHORT_REPEAT. A pattern may hold only MAX_UNBOUNDED of them. The engine also tries every
// start position, so with one such repeat an unanchored match on the 4096-character slice is at
// most quadratic (start x repeat length: ~16M steps, about 10 ms). With two (`.*a.*b`, `a+b+`)
// it is cubic, which took 10 s and more on `aaaa…!`. Repeats up to MAX_SHORT_REPEAT can't cover
// enough of the line to matter, so `a{1,16}b{1,16}` stays.
export const MAX_SHORT_REPEAT = 16
export const MAX_UNBOUNDED = 1

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
// - more than MAX_UNBOUNDED long repeats in total (see MAX_UNBOUNDED): chained ones
//   (`.*a.*b`, `a*a*a*b`) multiply their costs and take seconds on a 4096-character line;
// - a brace count over MAX_REPEAT_COUNT, however many digits it is written with;
// - a pattern over MAX_REGEX_CHARS.
// It reads a pattern `new RegExp` already accepted, so it only walks the syntax it needs.
export function assertSafeRegex(pattern: string): void {
  if (pattern.length > MAX_REGEX_CHARS) {
    refuse(`is longer than ${MAX_REGEX_CHARS} characters`, 'Use a shorter expression')
  }
  const stack: Frame[] = [{ inner: false }]
  // The group that just closed, until the next token says whether it is quantified.
  let closed: Frame | undefined
  let unbounded = 0
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
      // The nested check first: it names the exponential case.
      if (group?.inner && quantifier.max > 1) {
        refuse(
          'has a repeated group that already repeats inside',
          'A pattern like (a+)+ can take forever on a long line; simplify it'
        )
      }
      if (quantifier.long && ++unbounded > MAX_UNBOUNDED) {
        refuse(
          'has more than one long repeat (*, + or {n,})',
          'Use at most one *, + or {n,} — or plain search'
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
function quantifierAt(
  pattern: string,
  i: number
): { length: number; max: number; long: boolean } | undefined {
  const char = pattern[i]
  if (char === '*' || char === '+') {
    return { length: 1, max: Number.POSITIVE_INFINITY, long: true }
  }
  if (char === '?') return { length: 1, max: 1, long: false }
  if (char !== '{') return undefined
  // The whole quantifier, whatever its length (the pattern is capped at MAX_REGEX_CHARS), so
  // leading zeros can't push a count out of view.
  const match = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i))
  if (!match) return undefined
  const [text = '', exact = '0', comma, upper = ''] = match.slice(0, 4)
  const min = Number(exact)
  const max = comma === undefined ? min : upper === '' ? Infinity : Number(upper)
  if (min > MAX_REPEAT_COUNT || (max !== Infinity && max > MAX_REPEAT_COUNT)) {
    refuse(
      `repeats more than ${MAX_REPEAT_COUNT} times`,
      `Use a count of ${MAX_REPEAT_COUNT} or less`
    )
  }
  // An exact `{n}` is linear, however big: only a range can slide over the line.
  const long = comma !== undefined && max > MAX_SHORT_REPEAT
  return { length: text.length, max, long }
}

function refuse(problem: string, hint: string): never {
  throw new OvdError('INVALID_LOG_FILTER', `The search expression ${problem}`, hint)
}
