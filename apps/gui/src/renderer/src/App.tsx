import { DevicesProvider } from './devices/DevicesProvider'
import { Shell } from './shell/Shell'

export function App() {
  return (
    <DevicesProvider>
      <Shell />
    </DevicesProvider>
  )
}
