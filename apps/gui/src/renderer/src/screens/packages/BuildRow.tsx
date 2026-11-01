import type { PackageBuild, PackageInfo } from '@ovd/core'
import { Chip } from '../../ui/Chip'
import { cx } from '../../ui/cx'
import { rowTags, sizeText, whenText } from './packagesView'

interface BuildRowProps {
  build: PackageBuild
  // Once read, the row shows what the package says rather than its folder's name.
  info?: PackageInfo
  selected: boolean
  onSelect: () => void
  now: Date
}

export function BuildRow({ build, info, selected, onSelect, now }: BuildRowProps) {
  const tags = rowTags(build, info)
  return (
    <li className="list-none">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cx(
          'flex w-full cursor-pointer flex-col gap-[5px] rounded-tile border px-3 py-2.5 text-left hover:border-line-hover',
          selected ? 'border-accent-line bg-selected' : 'border-line-soft bg-panel'
        )}
      >
        <span className="font-mono text-meta break-all">{build.file}</span>
        <span className="flex items-center gap-1.5 text-label text-muted">
          {tags.arch && <Chip variant="accent">{tags.arch}</Chip>}
          {tags.type && <span>{tags.type}</span>}
          {tags.type && <span>·</span>}
          <span>{sizeText(build.size)}</span>
          <span className="flex-1" />
          <span>{whenText(build.modifiedAt, now)}</span>
        </span>
      </button>
    </li>
  )
}
