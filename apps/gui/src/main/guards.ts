// IPC payloads come from the renderer; check them before they reach core.
export function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  return value
}

// An optional on/off switch (`force`): absent is off.
export function optionalFlag(value: unknown, field: string): boolean {
  if (value === undefined) return false
  if (typeof value !== 'boolean') throw new TypeError(`${field} must be a boolean`)
  return value
}
