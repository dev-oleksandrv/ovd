import type { InputBackend, RemoteKey } from '@ovd/core'
import { Chip } from '../../ui/Chip'
import { keyDisabledReason } from './remoteView'

const ROWS: { keys: string[]; label: string; key: RemoteKey }[] = [
  { keys: ['↑', '↓', '←', '→'], label: 'D-pad', key: 'up' },
  { keys: ['Enter'], label: 'OK', key: 'ok' },
  { keys: ['Esc', 'Backspace'], label: 'Back', key: 'back' },
  { keys: ['Space'], label: 'Play/pause', key: 'play-pause' },
  { keys: ['H'], label: 'Home', key: 'home' },
  { keys: ['M'], label: 'Menu', key: 'menu' },
  { keys: [',', '.'], label: 'Rewind, fast-forward', key: 'rewind' }
]

// What the keyboard sends while the screen is shown and nothing is being typed.
export function KeyboardHint({ backend }: { backend: InputBackend | null }) {
  return (
    <div className="flex w-[260px] flex-col gap-1.5 text-label text-muted">
      <div className="text-subtle">Keyboard (not while typing)</div>
      {ROWS.filter((row) => keyDisabledReason(row.key, backend) === null).map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-2">
          <span className="flex gap-1">
            {row.keys.map((k) => (
              <Chip key={k} mono>
                {k}
              </Chip>
            ))}
          </span>
          <span>{row.label}</span>
        </div>
      ))}
    </div>
  )
}
