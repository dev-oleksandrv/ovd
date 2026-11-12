import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'
import { useScreenshot } from '../../screenshot/screenshotContext'
import { sizeLabel } from '../../screenshot/screenshotView'

// The captures folder's newest screenshots (Stage 4.3): loading, empty, error with Retry, or
// the rows, each with Show in folder (view-only, no CLI echo).
export function CapturesPanel({ platform }: { platform: 'darwin' | 'linux' }) {
  const { captures, refresh, reveal, openFolder } = useScreenshot()
  const shortcut = platform === 'darwin' ? '⌘K' : 'Ctrl+K'
  return (
    <Card
      title="Captures"
      action={
        <Button size="sm" icon="folder_open" onClick={() => void openFolder()}>
          Open folder
        </Button>
      }
    >
      {captures.status === 'loading' ? (
        <div role="status" className="px-3.5 py-3 text-muted">
          Reading the captures folder…
        </div>
      ) : captures.status === 'error' ? (
        <div role="alert" className="flex items-center gap-3 px-3.5 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="text-error-soft">{captures.error.message}</div>
            <div className="text-label text-muted">{captures.error.hint}</div>
          </div>
          <Button size="sm" icon="restart_alt" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      ) : captures.list.captures.length === 0 ? (
        <div className="flex flex-col gap-0.5 px-3.5 py-3">
          <div className="text-text-soft">No screenshots yet</div>
          <div className="text-label text-muted">
            Press Screenshot above, or “Take screenshot” in the palette ({shortcut}).
          </div>
        </div>
      ) : (
        <ul
          aria-label="Captures"
          className="m-0 flex max-h-[320px] list-none flex-col overflow-auto p-0"
        >
          {captures.list.captures.map((capture) => (
            <li
              key={capture.path}
              className="flex items-center gap-2.5 border-b border-line-row px-3.5 py-2 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="truncate font-mono text-text-soft">{capture.name}</div>
                <div className="text-label text-faint">
                  {capture.width}×{capture.height} · {sizeLabel(capture.bytes)} ·{' '}
                  <time dateTime={capture.takenAt}>
                    {new Date(capture.takenAt).toLocaleString()}
                  </time>
                </div>
              </div>
              <Button size="sm" onClick={() => void reveal(capture.path)}>
                Show in folder
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
