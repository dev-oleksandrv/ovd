import type { ReactNode } from 'react'
import { cx } from '../ui/cx'

interface TitleBarProps {
  version: string | null
  // macOS draws its traffic lights over the bar, so the bar leaves room for them.
  platform: 'darwin' | 'linux' | null
  children?: ReactNode
}

export function TitleBar({ version, platform, children }: TitleBarProps) {
  return (
    <div
      className={cx(
        'relative z-30 flex h-[46px] flex-none items-center gap-2.5 border-b border-line bg-chrome pr-3 [-webkit-app-region:drag]',
        platform === 'darwin' ? 'pl-[88px]' : 'pl-4'
      )}
    >
      <div className="flex flex-none items-center gap-2 whitespace-nowrap">
        <div className="grid size-[22px] place-items-center rounded-control-sm bg-accent font-mono text-label font-semibold text-accent-ink">
          ov
        </div>
        <div className="font-semibold tracking-[-0.01em]">OVD</div>
        {version && <div className="text-small text-faint">{version}</div>}
      </div>
      <div className="flex flex-1 items-center gap-2.5 [&>*]:[-webkit-app-region:no-drag]">
        {children}
      </div>
    </div>
  )
}
