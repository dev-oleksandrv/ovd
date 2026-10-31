import { Icon } from '../../ui/Icon'

// Under the device list: a stick without Developer Mode is invisible (ADR 0009).
export function SetupHint({ onSetup }: { onSetup: () => void }) {
  return (
    <button
      type="button"
      onClick={onSetup}
      className="mt-1 flex cursor-pointer flex-wrap items-center gap-2.5 rounded-card border border-dashed border-line-strong p-3 text-left text-muted hover:border-accent-line hover:text-text-soft"
    >
      <Icon name="developer_mode_tv" size={19} />
      <span className="min-w-[120px] flex-1 leading-[1.4]">Stick plugged in but not listed?</span>
      <span className="whitespace-nowrap text-accent">Set up Developer Mode →</span>
    </button>
  )
}
