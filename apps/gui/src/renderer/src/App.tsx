import { DevicesProvider } from './devices/DevicesProvider'
import { ScreenshotProvider } from './screenshot/ScreenshotProvider'
import { Shell } from './shell/Shell'

export function App() {
  return (
    <DevicesProvider>
      <ScreenshotProvider>
        <Shell />
      </ScreenshotProvider>
    </DevicesProvider>
  )
}
