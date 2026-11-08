import { Button } from '../../ui/Button'
import { Modal } from '../../ui/Modal'
import { confirmView, type ConfirmAction } from './appsView'

interface ConfirmUninstallProps {
  action: ConfirmAction
  // Plain strings, not an `InstalledApp`, so the gallery renders this with sample data.
  appTitle: string
  packageId: string
  deviceName: string
  onCancel: () => void
  onConfirm: () => void
}

// Asks before Uninstall or Uninstall & reinstall, which both remove the app's data. Cancel is
// the default focus, so Enter on open cancels. The action runs only on confirm, and so does its
// CLI echo (ADR 0005).
export function ConfirmUninstall({
  action,
  appTitle,
  packageId,
  deviceName,
  onCancel,
  onConfirm
}: ConfirmUninstallProps) {
  const view = confirmView(action, appTitle, deviceName)
  return (
    <Modal
      title={view.title}
      subtitle={packageId}
      subtitleMono
      onClose={onCancel}
      footer={
        <>
          <Button autoFocus onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {view.confirm}
          </Button>
        </>
      }
    >
      <div className="px-5 py-4.5 text-muted">{view.body}</div>
    </Modal>
  )
}
