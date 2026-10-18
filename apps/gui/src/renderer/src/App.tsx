import { lazy, Suspense, useEffect, useState } from 'react'
import { AppFrame } from './frame/AppFrame'
import { Welcome } from './screens/Welcome'

// The gallery is imported only in development, so it never ships in a release build.
const Gallery = import.meta.env.DEV
  ? lazy(() => import('./gallery/Gallery').then((m) => ({ default: m.Gallery })))
  : null

export function App() {
  const [info, setInfo] = useState<{ version: string; platform: 'darwin' | 'linux' } | null>(null)
  const [gallery, setGallery] = useState(false)

  useEffect(() => {
    window.ovd.appInfo().then(setInfo)
  }, [])

  useEffect(() => {
    if (!Gallery) return
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'g') {
        setGallery((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <AppFrame version={info?.version ?? null} platform={info?.platform ?? null}>
      {gallery && Gallery ? (
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      ) : (
        <Welcome />
      )}
    </AppFrame>
  )
}
