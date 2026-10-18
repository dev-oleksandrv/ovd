import { Icon } from './Icon'

interface LoadingStateProps {
  label: string
}

export function LoadingState({ label }: LoadingStateProps) {
  return (
    <div
      role="status"
      className="flex flex-1 items-center justify-center gap-2.5 px-6.5 py-10 text-muted"
    >
      <Icon name="progress_activity" size={18} spin className="text-accent" />
      {label}
    </div>
  )
}
