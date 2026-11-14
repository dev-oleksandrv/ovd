import { useCallback, useState } from 'react'
import { useFeedback } from '../../feedback/feedbackContext'
import { crashPullCli } from './crashesView'

export type CrashAction = 'download' | 'copy-path' | 'copy-prompt'

export interface CrashActions {
  busy: CrashAction | null
  // The report's host path once this panel downloaded it (or main said it already had it).
  path: string | null
  download(): void
  copyPath(): void
  copyPrompt(): void
  // Show in folder: view-only, no echo.
  reveal(): void
}

// The actions on one crash. Each echoes `ovd crash pull <id> --device <id>` (ADR 0005): the
// copies pull first when the report isn't on disk yet. The renderer sends `{device, id}` only.
export function useCrashActions(device: string, id: number): CrashActions {
  const { notify } = useFeedback()
  const [busy, setBusy] = useState<CrashAction | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const cli = crashPullCli(id, device)

  const run = useCallback(
    async (action: CrashAction): Promise<void> => {
      if (busy !== null) return
      setBusy(action)
      const ref = { device, id }
      try {
        if (action === 'download') {
          const result = await window.ovd.crashes.pull(ref)
          if (!result.ok) return notify({ tone: 'error', text: result.error.message, cli })
          setPath(result.data.path)
          notify({ tone: 'info', text: `Saved crash report to ${result.data.path}`, cli })
          return
        }
        const result =
          action === 'copy-path'
            ? await window.ovd.crashes.copyPath(ref)
            : await window.ovd.crashes.copyPrompt(ref)
        if (!result.ok) return notify({ tone: 'error', text: result.error.message, cli })
        setPath(result.data.path)
        const what = action === 'copy-path' ? 'crash report path' : 'prompt for your agent'
        notify({
          tone: 'info',
          text: result.data.downloaded
            ? `Downloaded the report and copied the ${what}`
            : `Copied the ${what}`,
          cli
        })
      } finally {
        setBusy(null)
      }
    },
    [busy, device, id, cli, notify]
  )

  return {
    busy,
    path,
    download: () => void run('download'),
    copyPath: () => void run('copy-path'),
    copyPrompt: () => void run('copy-prompt'),
    reveal() {
      void window.ovd.crashes.reveal({ device, id }).then((result) => {
        if (!result.ok) notify({ tone: 'error', text: result.error.message })
      })
    }
  }
}
