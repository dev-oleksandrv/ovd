import { OvdError } from '../errors/ovdError.js'

// A pattern longer than this is refused: no log search needs more, and a long pattern is what
// hides a backtracking bomb.
export const MAX_REGEX_CHARS = 512
// A `{n}`, `{n,}` or `{n,m}` count above this is refused: `(a+){1000000,}` is no search.
export const MAX_REPEAT_COUNT = 1000
// What a variable-length repeat can add to the work: `*`, `+` and `{n,}` take up to the whole
// slice (REGEX_SLICE_CHARS, 4096 characters), `{n,m}` takes m - n, `?` takes 1, an exact `{n}`
// is fixed and takes 0.
const OPEN_ENDED_RANGE = 4_096
// Backtracking work is at most (slice length) x the product over the repeats of (range + 1):
// nested quantifiers, backreferences and lookbehind are refused, so every repeat is a plain
// choice of how much to take, and the engine can try each combination of choices at most once
// per start position. A pattern is refused when that product passes this bound: it allows one
// open-ended repeat (`error.*timeout`: 4097) and a few short ranges (`a{1,16}b{1,16}`: 256),
// not two open-ended ones (`.*a.*b`: ~16.8M, seconds on `aaaa…!`) or `a{0,16}` eight times.
// Alternations outside a repeated group pick one branch, so they don't multiply; inside one
// they are already refused as nested.
export const MAX_BACKTRACK_PRODUCT = 4_096 * 64

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
// - repeats whose ranges multiply past MAX_BACKTRACK_PRODUCT (see there): chained ones
//   (`.*a.*b`, `a*a*a*b`, `a{0,16}` eight times) take seconds on a 4096-character line;
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
  let product = 1
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
      product *= quantifier.range + 1
      if (product > MAX_BACKTRACK_PRODUCT) {
        refuse(
          'can backtrack too much on a long line',
          'This pattern can backtrack too much — simplify it or use plain search'
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
): { length: number; max: number; range: number } | undefined {
  const char = pattern[i]
  if (char === '*' || char === '+') {
    return { length: 1, max: Number.POSITIVE_INFINITY, range: OPEN_ENDED_RANGE }
  }
  if (char === '?') return { length: 1, max: 1, range: 1 }
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
  const range = comma === undefined ? 0 : max === Infinity ? OPEN_ENDED_RANGE : max - min
  return { length: text.length, max, range }
}

function refuse(problem: string, hint: string): never {
  throw new OvdError('INVALID_LOG_FILTER', `The search expression ${problem}`, hint)
}
