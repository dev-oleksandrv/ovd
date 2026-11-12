import type { Device } from '@ovd/core'
import { useScreenshot } from '../../screenshot/screenshotContext'
import { ScreenPanel } from './ScreenPanel'
import { screenView } from './screenPanelView'
import { useScreen } from './useScreen'

interface ScreenViewProps {
  target: Device
  // The remote's successful sends so far: a stick's screenshot is out of date after one.
  sentCount: number
}

// The target's screen on Remote & Screen: the Virtual Device live, a stick's latest screenshot.
export function ScreenView({ target, sentCount }: ScreenViewProps) {
  const { latest } = useScreenshot()
  const screen = useScreen(target, sentCount, latest)
  const view = screenView(target, screen.live, screen.stick)
  return (
    <ScreenPanel
      view={view}
      canvasRef={screen.canvasRef}
      url={screen.stick.url}
      busy={screen.stick.busy}
      onRefresh={() => void screen.stick.refresh()}
      onRetry={screen.retry}
    />
  )
}
