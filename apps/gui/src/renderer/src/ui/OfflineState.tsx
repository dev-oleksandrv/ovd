import type { ReactNode } from 'react'
import { Icon } from './Icon'

interface OfflineStateProps {
  deviceName: string
  // What the screen can't do while the target is offline, e.g. "Remote unavailable".
  title: string
  // One line on what happened before the device went offline, e.g. why a session ended.
  detail?: string
  actions?: ReactNode
}

export function OfflineState({ deviceName, title, detail, actions }: OfflineStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6.5 py-10 text-center">
      <Icon name="portable_wifi_off" size={28} className="text-faint" />
      <div className="text-title font-semibold">
        {title} — {deviceName} is offline
      </div>
      <div className="max-w-[420px] leading-normal text-pretty text-muted">
        Reconnect the device or pick another target.
      </div>
      {detail && <div className="max-w-[420px] text-label text-faint">{detail}</div>}
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  )
}
