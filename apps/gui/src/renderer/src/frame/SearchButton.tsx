import { Icon } from '../ui/Icon'

interface SearchButtonProps {
  platform: 'darwin' | 'linux' | null
  onClick: () => void
}

export function SearchButton({ platform, onClick }: SearchButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[30px] min-w-[34px] flex-[0_1_280px] cursor-pointer items-center gap-2 overflow-hidden rounded-field border border-line-menu bg-field pr-2 pl-2.5 text-muted hover:border-line-toast"
    >
      <Icon name="search" />
      <span className="min-w-0 flex-1 truncate text-left">Search or run a command</span>
      <kbd className="rounded-chip border border-line-strong px-1.5 py-px font-mono text-label">
        {platform === 'linux' ? 'Ctrl K' : '⌘K'}
      </kbd>
    </button>
  )
}
