import { useState } from 'react'
import { Card } from './Card'
import { Icon } from './Icon'

interface CodeBlockProps {
  // The command that produced the output; shown as the title (ADR 0002: commands are real).
  title: string
  code: string
}

export function CodeBlock({ title, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Card
      title={title}
      sunken
      action={
        <button
          type="button"
          onClick={copy}
          className="flex cursor-pointer items-center gap-1 text-small text-muted hover:text-text"
        >
          <Icon name={copied ? 'check' : 'content_copy'} size={15} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      }
    >
      <pre className="m-0 overflow-auto px-3.5 py-3 font-mono text-small leading-relaxed text-text-soft">
        {code}
      </pre>
    </Card>
  )
}
