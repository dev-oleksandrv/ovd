import { z } from 'zod'
import { parseJson, unexpectedOutput } from './unexpectedOutput.js'

// Signed in: exits 2 at once with `errorCode: 2` ("Already logged in"). Signed out: prints
// `status: "pending"` with a verification URL and code, then waits for the browser sign-in
// and prints `status: "success"` (fixtures/0.24/vega-devmode-login). No browser opens on its own.
const schema = z.union([
  z.object({ status: z.literal('error'), errorCode: z.literal(2) }),
  z.object({ status: z.literal('pending') })
])

const promptSchema = z.object({
  status: z.literal('pending'),
  // The surfaces open it in the browser, so only an https link gets through.
  verificationUri: z.url({ protocol: /^https$/ }),
  userCode: z.string().min(1)
})

// The last answer of a `vega devmode … --json` command
// (fixtures/0.24/vega-devmode-enable-device, vega-devmode-login).
const resultSchema = z.union([
  z.object({ status: z.literal('success') }),
  z.object({ status: z.literal('error'), errorCode: z.number(), errorMessage: z.string() })
])

export type DevmodeLogin = { signedIn: true } | { signedIn: false; pending: true }

export interface LoginPrompt {
  verificationUri: string
  userCode: string
}

export type DevmodeResult = { ok: true } | { ok: false; errorCode: number; message: string }

export function parseDevmodeLogin(stdout: string): DevmodeLogin {
  const [first = ''] = jsonObjects(stdout)
  const parsed = schema.safeParse(parseJson(first))
  if (!parsed.success) throw unexpectedOutput('vega devmode login', stdout)
  return parsed.data.status === 'pending' ? { signedIn: false, pending: true } : { signedIn: true }
}

// The URL and code to show while `vega devmode login --json` waits; null until it has printed them.
export function parseDevmodeLoginPrompt(stdout: string): LoginPrompt | null {
  for (const object of jsonObjects(stdout)) {
    const parsed = promptSchema.safeParse(parseJson(object))
    if (parsed.success) {
      return { verificationUri: parsed.data.verificationUri, userCode: parsed.data.userCode }
    }
  }
  return null
}

export function parseDevmodeResult(command: string, stdout: string): DevmodeResult {
  const last = jsonObjects(stdout).at(-1) ?? ''
  const parsed = resultSchema.safeParse(parseJson(last))
  if (!parsed.success) throw unexpectedOutput(command, stdout)
  return parsed.data.status === 'success'
    ? { ok: true }
    : { ok: false, errorCode: parsed.data.errorCode, message: parsed.data.errorMessage }
}

// `login` prints one pretty-printed object per state, and a stopped process may leave anything
// after them, so the objects are found by brace depth.
function jsonObjects(stdout: string): string[] {
  const objects: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  for (let i = 0; i < stdout.length; i++) {
    const ch = stdout[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"' && depth > 0) inString = true
    else if (ch === '{') {
      if (depth++ === 0) start = i
    } else if (ch === '}' && depth > 0 && --depth === 0) objects.push(stdout.slice(start, i + 1))
  }
  return objects
}
