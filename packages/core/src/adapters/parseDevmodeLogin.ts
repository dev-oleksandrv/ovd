import { z } from 'zod'
import { parseJson, unexpectedOutput } from './unexpectedOutput.js'

// Signed in: exits 2 at once with `errorCode: 2` ("Already logged in"). Signed out: prints
// `status: "pending"` with a verification URL and code, then waits for the browser sign-in
// (fixtures/0.24/vega-devmode-login). No browser opens on its own.
const schema = z.union([
  z.object({ status: z.literal('error'), errorCode: z.literal(2) }),
  z.object({ status: z.literal('pending') })
])

export type DevmodeLogin = { signedIn: true } | { signedIn: false; pending: true }

export function parseDevmodeLogin(stdout: string): DevmodeLogin {
  const parsed = schema.safeParse(parseJson(firstObject(stdout)))
  if (!parsed.success) throw unexpectedOutput('vega devmode login', stdout)
  return parsed.data.status === 'pending' ? { signedIn: false, pending: true } : { signedIn: true }
}

// The probe is stopped mid-run, so anything may follow the first JSON object.
function firstObject(stdout: string): string {
  const start = stdout.indexOf('{')
  if (start < 0) return ''
  let depth = 0
  let inString = false
  for (let i = start; i < stdout.length; i++) {
    const ch = stdout[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return stdout.slice(start, i + 1)
  }
  return ''
}
