import { useState } from 'react'
import type { LogsFilter } from '../../../../preload/api'
import { Button } from '../../ui/Button'
import { CommandLine } from '../../ui/CommandLine'
import { InlineError } from '../../ui/InlineError'
import { Modal } from '../../ui/Modal'
import { TextField } from '../../ui/TextField'
import { filterNameError, logsSaveCli } from './logsView'

interface SaveFilterDialogProps {
  filter: LogsFilter
  // The built-in preset keys (reserved names) and the names in use.
  reserved: string[]
  taken: string[]
  // The `--preset` the filter equals, if any, for the echo.
  base: string | null
  // Resolves with main's error, or null once saved.
  onSave: (name: string, force: boolean) => Promise<string | null>
  onClose: () => void
}

// "Save filter": asks a name (core's rule, checked here first and again in core) and shows the
// `ovd logs filter save` that does the same. A name in use is replaced only by asking for it.
export function SaveFilterDialog({
  filter,
  reserved,
  taken,
  base,
  onSave,
  onClose
}: SaveFilterDialogProps) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const invalid = name === '' ? null : filterNameError(name, reserved)
  const exists = taken.includes(name)
  const ready = name !== '' && invalid === null

  const save = async (): Promise<void> => {
    if (!ready || busy) return
    setBusy(true)
    const failed = await onSave(name, exists)
    setBusy(false)
    if (failed === null) onClose()
    else setError(failed)
  }

  return (
    <Modal
      title="Save filter"
      subtitle="Saved filters are kept on this computer and work with ovd logs --preset"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!ready}
            disabledReason={invalid ?? 'Enter a name'}
            onClick={() => void save()}
          >
            {exists ? 'Replace' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 px-5 py-4">
        <TextField
          label="Filter name"
          value={name}
          onChange={(value) => {
            setName(value)
            setError(null)
          }}
          onEnter={() => void save()}
          autoFocus
        />
        {invalid && (
          <div role="alert" className="text-label text-error">
            {invalid}
          </div>
        )}
        {exists && invalid === null && (
          <div className="text-label text-muted">
            A filter named {name} exists: Replace overwrites it.
          </div>
        )}
        {error && <InlineError title="Couldn’t save the filter" body={error} />}
        <CommandLine
          command={
            ready
              ? logsSaveCli(name, filter, base, exists)
              : logsSaveCli('NAME', filter, base).replace('NAME', '<name>')
          }
        />
      </div>
    </Modal>
  )
}
