import { useState } from 'react'
import { useFeedback } from '../feedback/feedbackContext'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'

// Placeholder main screen until Doctor (Stage 1.2) takes over. Its one action is the
// end-to-end smoke test: renderer → preload → main → core, with the CLI echo.
export function Welcome() {
  const { notify } = useFeedback()
  const [busy, setBusy] = useState(false)

  const sayHello = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.ovd.hello()
      notify({ tone: 'ok', text: result.message, cli: 'ovd hello' })
    } catch {
      notify({ tone: 'error', text: 'The core did not answer. Restart OVD.', cli: 'ovd hello' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <EmptyState
      title="OVD is ready"
      body="Devices, apps and logs arrive in the next versions."
      actions={
        <Button variant="primary" icon="waving_hand" loading={busy} onClick={sayHello}>
          Run ovd hello
        </Button>
      }
    />
  )
}
