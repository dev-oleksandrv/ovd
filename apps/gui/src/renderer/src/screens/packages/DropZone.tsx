import { useState, type DragEvent } from 'react'
import { cx } from '../../ui/cx'
import { Icon } from '../../ui/Icon'

interface DropZoneProps {
  onFile: (file: File) => void
  onPick: () => void
}

// "Drop a .vpkg here": inspects the file. It stops the drop from reaching the window, where a
// dropped file would open as the project (Stage 2.1).
export function DropZone({ onFile, onPick }: DropZoneProps) {
  const [over, setOver] = useState(false)
  const files = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  return (
    <button
      type="button"
      onClick={onPick}
      onDragOver={(event) => {
        if (!files(event)) return
        event.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        if (!files(event)) return
        event.preventDefault()
        event.stopPropagation()
        setOver(false)
        const file = event.dataTransfer.files[0]
        if (file) onFile(file)
      }}
      className={cx(
        'flex cursor-pointer flex-col items-center gap-1.5 rounded-card border border-dashed p-[18px] text-center hover:border-accent hover:text-text-soft',
        over ? 'border-accent text-text-soft' : 'border-line-dashed text-muted'
      )}
    >
      <Icon name="deployed_code_update" size={24} />
      <span>Drop a .vpkg here</span>
      <span className="text-label">
        or watch <span className="font-mono">build/</span>
      </span>
    </button>
  )
}
