import type { PressResult, TextResult } from '@ovd/core'

// "Pressed down, ok on Living room stick (inputd-cli)".
export function pressedLine(result: PressResult): string {
  return `Pressed ${result.keys.join(', ')} on ${result.target.name} (${result.backend})\n`
}

// The text itself isn't printed again: the user typed it, and it may be a password.
export function typedLine(result: TextResult): string {
  const chars = result.length === 1 ? 'character' : 'characters'
  return `Typed ${result.length} ${chars} on ${result.target.name} (${result.backend})\n`
}
