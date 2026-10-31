import { cx } from '../ui/cx'
import { Icon } from '../ui/Icon'

interface ProgressLineProps {
  text: string
  done?: boolean
}

// A wizard step's running or finished state: spinner or check, then the text.
export function ProgressLine({ text, done = false }: ProgressLineProps) {
  return (
    <div
      role="status"
      className={cx('flex items-center gap-2.5', done ? 'text-accent-bright' : 'text-text-soft')}
    >
      <Icon
        name={done ? 'check_circle' : 'progress_activity'}
        size={18}
        fill={done}
        spin={!done}
        className="text-accent"
      />
      {text}
    </div>
  )
}
