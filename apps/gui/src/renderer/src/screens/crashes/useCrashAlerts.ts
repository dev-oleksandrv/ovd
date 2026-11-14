import { useEffect, useRef } from 'react'
import { useFeedback } from '../../feedback/feedbackContext'
import { addNew } from './crashNew'
import { crashToastText } from './crashesView'

// Main's watcher pushes each new report from any screen: it counts toward the sidebar badge
// and raises a toast, "<app> crashed · <summary>", whose Open shows it in Crashes. Only
// validated fields and bounded device text go into the toast, and it is rendered as text.
export function useCrashAlerts(open: (device: string, id: number) => void): void {
  const { notify } = useFeedback()
  // The toast's button runs the latest `open`, not the one from when the toast was raised.
  const openRef = useRef(open)
  openRef.current = open

  useEffect(
    () =>
      window.ovd.crashes.onNew(({ device, crash }) => {
        addNew(device.id, crash.id)
        notify({
          tone: 'error',
          text: crashToastText(crash),
          action: { label: 'Open', run: () => openRef.current(device.id, crash.id) }
        })
      }),
    [notify]
  )
}
