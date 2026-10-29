// IPC payloads come from the renderer; check them before they reach core.
export function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  return value
}
