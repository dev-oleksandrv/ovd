import type { LogsPreset, SavedLogsFilter } from '../../../../preload/api'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { cx } from '../../ui/cx'

interface PresetsRowProps {
  presets: LogsPreset[]
  saved: SavedLogsFilter[]
  // The key or name the filter equals; null shows "Custom" (F19).
  active: string | null
  onPick: (name: string) => void
  onSave: () => void
  onDelete: (name: string) => void
}

const CHIP = 'inline-flex h-[24px] items-center rounded-chip border px-2 text-small'

// The Presets row: the built-ins, then the saved filters (each with a delete), then Save filter.
// A filter edited by hand matches none of them, so "Custom" shows.
export function PresetsRow({ presets, saved, active, onPick, onSave, onDelete }: PresetsRowProps) {
  const pick = (name: string, label: string, disabledReason?: string) => (
    <button
      type="button"
      aria-pressed={active === name}
      disabled={disabledReason !== undefined}
      title={disabledReason}
      onClick={() => onPick(name)}
      className={cx(
        CHIP,
        disabledReason !== undefined
          ? 'cursor-not-allowed border-line-strong text-faint'
          : active === name
            ? 'cursor-pointer border-accent-line bg-accent/12 text-accent'
            : 'cursor-pointer border-line-strong text-muted hover:bg-control-hover hover:text-text'
      )}
    >
      {label}
    </button>
  )
  return (
    <div role="group" aria-label="Presets" className="flex flex-wrap items-center gap-1.5">
      <span className="text-meta text-muted">Presets</span>
      {presets.map((preset) => (
        <span key={preset.key}>{pick(preset.key, preset.label)}</span>
      ))}
      {saved.map((item) => (
        <span key={item.name} className="inline-flex items-center gap-0.5">
          {pick(item.name, item.name, item.valid ? undefined : item.error.message)}
          <button
            type="button"
            aria-label={`Delete saved filter ${item.name}`}
            title={`Delete saved filter ${item.name}`}
            onClick={() => onDelete(item.name)}
            className="grid size-[20px] cursor-pointer place-items-center rounded-chip text-faint hover:bg-control-hover hover:text-text"
          >
            <Icon name="close" size={14} />
          </button>
        </span>
      ))}
      {active === null && (
        <span
          aria-current="true"
          className={cx(CHIP, 'border-accent-line bg-accent/12 text-accent')}
        >
          Custom
        </span>
      )}
      <Button
        size="sm"
        icon="bookmark_add"
        onClick={onSave}
        disabled={active !== null}
        disabledReason="Edit the filters first: this one is already a preset"
      >
        Save filter
      </Button>
    </div>
  )
}
