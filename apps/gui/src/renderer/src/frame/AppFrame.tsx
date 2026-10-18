import type { ReactNode } from 'react'
import { ToastViewport } from '../feedback/ToastViewport'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'

interface AppFrameProps {
  version: string | null
  platform: 'darwin' | 'linux' | null
  children: ReactNode
}

// Title bar, sidebar, main area and status bar, as in the design's frame.
export function AppFrame({ version, platform, children }: AppFrameProps) {
  return (
    <div className="flex h-screen w-screen min-w-0 flex-col overflow-hidden bg-bg">
      <TitleBar version={version} platform={platform} />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      </div>
      <StatusBar />
      <ToastViewport />
    </div>
  )
}
