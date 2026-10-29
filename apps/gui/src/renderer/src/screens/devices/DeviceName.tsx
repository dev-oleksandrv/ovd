import { useState } from 'react'
import { Button } from '../../ui/Button'
import { IconButton } from '../../ui/IconButton'
import { TextField } from '../../ui/TextField'

interface DeviceNameProps {
  name: string
  onRename: (name: string) => void
}

// The detail header's name with its inline rename (design: Save / Cancel, Enter, Esc).
export function DeviceName({ name, onRename }: DeviceNameProps) {
  const [draft, setDraft] = useState<string | null>(null)

  if (draft === null) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="truncate text-display font-semibold tracking-[-0.015em]">{name}</div>
        <IconButton icon="edit" label="Rename" size={17} onClick={() => setDraft(name)} />
      </div>
    )
  }

  const cancel = (): void => setDraft(null)
  const save = (): void => {
    const next = draft.trim()
    setDraft(null)
    // An empty name cancels, as in the design.
    if (next !== '' && next !== name) onRename(next)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <TextField
        label="Device name"
        value={draft}
        onChange={setDraft}
        onEnter={save}
        onEscape={cancel}
        autoFocus
      />
      <Button variant="primary" onClick={save}>
        Save
      </Button>
      <Button variant="secondary" onClick={cancel}>
        Cancel
      </Button>
    </div>
  )
}
