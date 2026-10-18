export interface HelloResult {
  ok: true
  message: string
}

// Smoke-test action: proves a surface can reach core end to end.
export function hello(): HelloResult {
  return { ok: true, message: 'OVD core is alive' }
}
