import type { LoginPrompt } from '@ovd/core'
import { Button } from '../ui/Button'

interface LoginPromptCardProps {
  prompt: LoginPrompt
  onCopy: () => void
  onOpen: () => void
}

// The link and code `vega devmode login` waits on (design step 2, `sWaiting`).
export function LoginPromptCard({ prompt, onCopy, onOpen }: LoginPromptCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line-menu bg-input px-4 py-3.5">
      <div className="flex flex-col gap-1">
        <div className="text-label text-subtle">Go to</div>
        <div className="font-mono break-all text-text">{prompt.verificationUri}</div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[160px] flex-1 flex-col gap-1">
          <div className="text-label text-subtle">Enter this code</div>
          <div className="font-mono text-hero font-medium tracking-[.12em] text-text">
            {prompt.userCode}
          </div>
        </div>
        <Button icon="content_copy" onClick={onCopy}>
          Copy
        </Button>
        <Button variant="primary" icon="open_in_new" onClick={onOpen}>
          Open browser
        </Button>
      </div>
    </div>
  )
}
