import { cx } from '../../ui/cx'

// The design tints each app; OVD picks a token per package ID so an app keeps its color.
const TINTS = ['bg-warning', 'bg-info', 'bg-accent', 'bg-error-soft'] as const

interface AppAvatarProps {
  packageId: string
  title: string
  size?: 'row' | 'detail'
}

export function AppAvatar({ packageId, title, size = 'row' }: AppAvatarProps) {
  let hash = 0
  for (const ch of packageId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return (
    <div
      aria-hidden
      className={cx(
        'grid flex-none place-items-center rounded-tile font-bold text-bg',
        size === 'row' ? 'size-[34px]' : 'size-10 text-title',
        TINTS[hash % TINTS.length]
      )}
    >
      {title.slice(0, 1).toUpperCase()}
    </div>
  )
}
