import type { LogExportFormat } from '@ovd/core'
import type { LogsFilter, LogsPreset, SavedLogsFilter } from '../../../../preload/api'
import { Button } from '../../ui/Button'
import { MenuButton } from '../../ui/MenuButton'
import { Segmented } from '../../ui/Segmented'
import { Select, type SelectOption } from '../../ui/Select'
import { TextField } from '../../ui/TextField'
import { ToggleButton } from '../../ui/ToggleButton'
import { FilterChips } from './FilterChips'
import { FiltersPopover } from './FiltersPopover'
import { LEVELS, levelLetter, packageValue, type LevelLetter } from './logsView'
import { PresetsRow } from './PresetsRow'
import { RuleChips } from './RuleChips'

interface LogToolbarProps {
  label: string
  filter: LogsFilter
  packages: SelectOption[]
  search: string
  regex: boolean
  regexError: string | null
  paused: boolean
  onSearch: (text: string) => void
  onRegex: (on: boolean) => void
  onLevel: (level: LevelLetter) => void
  onPackage: (value: string) => void
  onPause: () => void
  onResume: () => void
  onClear: () => void
  onExport: (format: LogExportFormat) => void
  onBundle: () => void
  presets: LogsPreset[]
  saved: SavedLogsFilter[]
  // The preset key or saved name the filter equals; null is "Custom".
  activePreset: string | null
  onPreset: (name: string) => void
  onSavePreset: () => void
  onDeletePreset: (name: string) => void
  // Edits the filter (the popover, the chips).
  onEdit: (change: (filter: LogsFilter) => LogsFilter) => void
}

export function LogToolbar(props: LogToolbarProps) {
  const level = levelLetter(props.filter.level)
  return (
    <div className="flex flex-col gap-2 border-b border-line px-6 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-[220px] flex-[1_1_260px] flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <TextField label="Search logs" value={props.search} onChange={props.onSearch} />
            <ToggleButton label="Regex" pressed={props.regex} onChange={props.onRegex} mono>
              .*
            </ToggleButton>
          </div>
          {props.regexError && (
            <div role="alert" className="text-label text-error">
              Invalid regular expression: {props.regexError}
            </div>
          )}
        </div>
        <Segmented label="Level" options={[...LEVELS]} value={level} onChange={props.onLevel} />
        <Select
          label="Package"
          options={props.packages}
          value={packageValue(props.filter)}
          onChange={props.onPackage}
        />
        <FiltersPopover filter={props.filter} onChange={props.onEdit} />
        <div className="flex-1" />
        {props.paused ? (
          <Button size="sm" icon="play_arrow" onClick={props.onResume}>
            Resume
          </Button>
        ) : (
          <Button size="sm" icon="pause" onClick={props.onPause}>
            Pause
          </Button>
        )}
        <Button size="sm" icon="delete_sweep" onClick={props.onClear}>
          Clear
        </Button>
        <MenuButton
          label="Export"
          icon="download"
          size="sm"
          items={[
            { id: 'text', label: 'Plain text (.txt)', onSelect: () => props.onExport('text') },
            { id: 'jsonl', label: 'JSON lines (.jsonl)', onSelect: () => props.onExport('jsonl') }
          ]}
        />
        <Button size="sm" icon="folder_zip" onClick={props.onBundle}>
          Bundle
        </Button>
      </div>
      <div className="flex items-center gap-2 text-meta text-muted">
        <span>{props.label}</span>
        <span className="flex-1" />
      </div>
      <PresetsRow
        presets={props.presets}
        saved={props.saved}
        active={props.activePreset}
        onPick={props.onPreset}
        onSave={props.onSavePreset}
        onDelete={props.onDeletePreset}
      />
      <FilterChips filter={props.filter} onChange={props.onEdit} />
      <RuleChips filter={props.filter} onChange={props.onEdit} />
    </div>
  )
}
