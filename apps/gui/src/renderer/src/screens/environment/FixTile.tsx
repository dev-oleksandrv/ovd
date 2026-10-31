import { Icon } from '../../ui/Icon'

interface FixTileProps {
  icon: string
  title: string
  detail: string
  busy?: boolean
  onClick: () => void
}

// A first-run fix with a title and a line about it (design `frVvd`, Set up a Fire TV stick).
export function FixTile({ icon, title, detail, busy = false, onClick }: FixTileProps) {
  return (
    <button
      type="button"
      aria-busy={busy || undefined}
      onClick={busy ? undefined : onClick}
      className="flex cursor-pointer items-start gap-2.5 rounded-tile border border-line-menu bg-input px-3.5 py-3 text-left hover:border-accent-line hover:bg-row-hover"
    >
      <Icon
        name={busy ? 'progress_activity' : icon}
        size={20}
        spin={busy}
        className="text-accent"
      />
      <span className="flex flex-col gap-[3px]">
        <span className="font-semibold">{title}</span>
        <span className="text-small leading-[1.4] text-muted">{detail}</span>
      </span>
    </button>
  )
}
