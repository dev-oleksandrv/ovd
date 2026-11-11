import { useState } from 'react'
import { Button } from '../../ui/Button'
import { Card } from '../../ui/Card'

interface TypeIntoTvProps {
  // The Virtual Device types printable ASCII only; a stick takes any text.
  asciiOnly: boolean
  onSend: (text: string) => Promise<boolean>
}

// Types into the focused field on the TV. Keys typed here never reach the remote: the screen's
// key handler skips events from fields.
export function TypeIntoTv({ asciiOnly, onSend }: TypeIntoTvProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (text === '' || sending) return
    setSending(true)
    const ok = await onSend(text)
    setSending(false)
    if (ok) setText('')
  }
  return (
    <Card title="Type into TV">
      <div className="flex flex-col gap-2 p-3.5">
        <div className="flex gap-2">
          <input
            type="text"
            aria-label="Text to type"
            value={text}
            placeholder="Text for the focused field"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void send()
            }}
            className="h-[30px] min-w-0 flex-1 rounded-control border border-line-strong bg-input px-2.5 text-text outline-none placeholder:text-faint focus:border-accent-line"
          />
          <Button
            variant="primary"
            icon="send"
            onClick={() => void send()}
            loading={sending}
            disabled={text === ''}
            disabledReason="Type some text first"
          >
            Send
          </Button>
        </div>
        <div className="text-label text-faint">
          {asciiOnly
            ? 'The Virtual Device types letters, digits and symbols on a US keyboard (no accents or emoji).'
            : 'Sent as typed, to the field that has focus on the TV.'}
        </div>
      </div>
    </Card>
  )
}
