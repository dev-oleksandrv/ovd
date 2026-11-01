import type { ProjectMode } from '@ovd/core'
import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'
import { pinsLine } from '../project/projectView'

interface ProjectCardProps {
  // null: no project and no .vpkg loaded.
  mode: ProjectMode | null
  // A file is being dragged over the window.
  dragging: boolean
  onPickVpkg: () => void
  onPickFolder: () => void
}

// Sidebar bottom (Stage 2.1): the open project folder, or no-project mode with the .vpkg
// to install. Dropping a .vpkg anywhere in the window opens it too.
export function ProjectCard({ mode, dragging, onPickVpkg, onPickFolder }: ProjectCardProps) {
  if (mode?.kind === 'folder') {
    const pins = pinsLine(mode)
    return (
      <section
        aria-label="Project"
        className="flex flex-col gap-1.5 rounded-tile border border-line-soft bg-panel p-2.5"
      >
        <div className="flex items-center gap-1.5 text-small font-medium">
          <Icon name="folder_open" size={16} className="text-accent" />
          {mode.name}
        </div>
        <div className="font-mono text-micro break-all text-faint">{mode.displayPath}</div>
        {pins && <div className="text-label text-muted">{pins}</div>}
      </section>
    )
  }
  return (
    <section
      aria-label="Project"
      className={cx(
        'flex flex-col gap-1.5 rounded-tile border border-dashed p-2.5 hover:border-accent',
        dragging ? 'border-accent bg-accent/6' : 'border-line-dashed bg-panel'
      )}
    >
      <button
        type="button"
        title="Open a .vpkg"
        onClick={onPickVpkg}
        className="flex cursor-pointer flex-col gap-1.5 text-left"
      >
        <span className="flex items-center gap-1.5 text-small font-medium">
          <Icon name="deployed_code_update" size={16} className="text-muted" />
          No project
        </span>
        {dragging ? (
          <span className="text-label font-medium text-accent">Drop to open</span>
        ) : (
          <span className="text-label text-muted">Drop a .vpkg</span>
        )}
        {mode?.kind === 'vpkg' && (
          <span className="font-mono text-micro break-all text-text-soft">{mode.file}</span>
        )}
      </button>
      <button
        type="button"
        onClick={onPickFolder}
        className="cursor-pointer text-left text-label text-accent"
      >
        Open a project folder…
      </button>
    </section>
  )
}
