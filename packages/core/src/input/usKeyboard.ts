// Printable ASCII on a US keyboard, as evdev key codes, for typing on the Virtual Device: its
// gRPC `KeyboardEvent.text` garbled capitals, while per-key events with an explicit
// KEY_LEFTSHIFT typed exactly (ARCHITECTURE §8).
export const KEY_LEFTSHIFT = 42

export interface UsKey {
  code: number
  shift: boolean
}

const ROWS: [plain: string, shifted: string, firstCode: number][] = [
  ['1234567890-=', '!@#$%^&*()_+', 2],
  ['qwertyuiop[]', 'QWERTYUIOP{}', 16],
  ["asdfghjkl;'`", 'ASDFGHJKL:"~', 30],
  ['\\zxcvbnm,./', '|ZXCVBNM<>?', 43]
]

const KEYS = new Map<string, UsKey>([[' ', { code: 57, shift: false }]])
for (const [plain, shifted, first] of ROWS) {
  for (let i = 0; i < plain.length; i++) {
    KEYS.set(plain.charAt(i), { code: first + i, shift: false })
    KEYS.set(shifted.charAt(i), { code: first + i, shift: true })
  }
}

// The key for one character, or null outside printable ASCII.
export function usKey(char: string): UsKey | null {
  return KEYS.get(char) ?? null
}
