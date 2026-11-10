import type { LogCounts } from '@ovd/core'
import { ToggleButton } from '../../ui/ToggleButton'

interface LogFooterProps {
  counts: LogCounts
  newLines: number
  follow: boolean
  onFollow: (on: boolean) => void
  // Scrolls to the bottom, turns Follow on and resumes.
  onShowNew: () => void
  restartAfterInstall: boolean
  onRestartAfterInstall: (on: boolean) => void
}

export function LogFooter({
  counts,
  newLines,
  follow,
  onFollow,
  onShowNew,
  restartAfterInstall,
  onRestartAfterInstall
}: LogFooterProps) {
  return (
    <div className="flex h-[38px] flex-none items-center gap-3 border-t border-line px-6 text-meta text-muted">
      <span>
        {counts.lines} {counts.lines === 1 ? 'line' : 'lines'} · {counts.errors}{' '}
        {counts.errors === 1 ? 'error' : 'errors'}
      </span>
      <span className="flex-1" />
      {newLines > 0 && (
        <button
          type="button"
          onClick={onShowNew}
          className="cursor-pointer rounded-chip bg-accent/12 px-2 py-0.5 text-accent hover:bg-accent/20"
        >
          {newLines} new {newLines === 1 ? 'line' : 'lines'}
        </button>
      )}
      <ToggleButton icon="autorenew" pressed={restartAfterInstall} onChange={onRestartAfterInstall}>
        Restart session after install
      </ToggleButton>
      <ToggleButton icon="vertical_align_bottom" pressed={follow} onChange={onFollow}>
        Follow
      </ToggleButton>
    </div>
  )
}
