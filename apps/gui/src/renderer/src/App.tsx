import { lazy, Suspense, useEffect, useState } from 'react'
import { DevicesProvider } from './devices/DevicesProvider'
import { targetDevice, useDevicesContext } from './devices/devicesContext'
import { useFeedback } from './feedback/feedbackContext'
import { AppFrame } from './frame/AppFrame'
import { CommandPalette } from './frame/CommandPalette'
import { NavGroup } from './frame/NavGroup'
import { NavItem } from './frame/NavItem'
import { SdkStatus } from './frame/SdkStatus'
import { SearchButton } from './frame/SearchButton'
import { TargetPicker } from './frame/TargetPicker'
import { TargetStatus } from './frame/TargetStatus'
import { DevicesScreen } from './screens/devices/DevicesScreen'
import { useSdk } from './sdk/useSdk'
import { paletteItems } from './shell/paletteItems'

// The gallery is imported only in development, so it never ships in a release build.
const Gallery = import.meta.env.DEV
  ? lazy(() => import('./gallery/Gallery').then((m) => ({ default: m.Gallery })))
  : null

export function App() {
  return (
    <DevicesProvider>
      <Shell />
    </DevicesProvider>
  )
}

function Shell() {
  const [info, setInfo] = useState<{ version: string; platform: 'darwin' | 'linux' } | null>(null)
  const [gallery, setGallery] = useState(false)
  const [menu, setMenu] = useState(false)
  const [palette, setPalette] = useState(false)
  const { state, setTarget } = useDevicesContext()
  const { notify } = useFeedback()
  const sdk = useSdk(state.status)
  const devices = state.status === 'ready' ? state.devices : []
  const target = targetDevice(state)

  useEffect(() => {
    window.ovd.appInfo().then(setInfo)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setMenu(false)
        setPalette((open) => !open)
      } else if (event.key === 'Escape') {
        setPalette(false)
      } else if (Gallery && mod && event.shiftKey && event.key.toLowerCase() === 'g') {
        setGallery((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const items = paletteItems({
    devices,
    target: target?.id ?? null,
    go: () => setGallery(false),
    switchTarget: (device) => void setTarget(device),
    later: (label) => notify({ tone: 'info', text: `${label} is coming in a later version` })
  })

  return (
    <AppFrame
      version={info?.version ?? null}
      platform={info?.platform ?? null}
      titleBar={
        <>
          <TargetPicker
            devices={devices}
            target={target}
            open={menu}
            onOpenChange={setMenu}
            onPick={(device) => void setTarget(device)}
          />
          <div className="flex-1" />
          <SearchButton
            platform={info?.platform ?? null}
            onClick={() => {
              setMenu(false)
              setPalette(true)
            }}
          />
        </>
      }
      status={
        <>
          <SdkStatus sdk={sdk} />
          <TargetStatus target={target} onClick={() => setMenu((open) => !open)} />
        </>
      }
      sidebar={
        // Only shipped screens appear (ADR 0018); Setup → Doctor joins in Stage 1.2.
        <NavGroup label="Device">
          <NavItem label="Devices" icon="tv" active={!gallery} onClick={() => setGallery(false)} />
        </NavGroup>
      }
    >
      {gallery && Gallery ? (
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      ) : (
        <DevicesScreen />
      )}
      {palette && <CommandPalette items={items} onClose={() => setPalette(false)} />}
    </AppFrame>
  )
}
