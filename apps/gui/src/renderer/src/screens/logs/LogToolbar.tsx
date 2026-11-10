import type { LogExportFormat } from '@ovd/core'
import type { LogsFilter } from '../../../../preload/api'
import { Button } from '../../ui/Button'
import { Chip } from '../../ui/Chip'
import { MenuButton } from '../../ui/MenuButton'
import { Segmented } from '../../ui/Segmented'
import { Select, type SelectOption } from '../../ui/Select'
import { TextField } from '../../ui/TextField'
import { ToggleButton } from '../../ui/ToggleButton'
import { LEVELS, packageValue, type LevelLetter } from './logsView'

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
}

export function LogToolbar(props: LogToolbarProps) {
  const level = (props.filter.level?.toLowerCase() ?? 'v') as LevelLetter
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
      </div>
      <div className="flex items-center gap-2 text-meta text-muted">
        <span>{props.label}</span>
        <span className="flex-1" />
        <span>Presets</span>
        <Chip variant="accent">All</Chip>
      </div>
    </div>
  )
}
