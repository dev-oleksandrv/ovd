interface CommandLineProps {
  // The command core runs (commands shown are real), optionally with its outcome.
  command: string
  result?: string
}

// A one-line command as the wizards show it, without a Copy button.
export function CommandLine({ command, result }: CommandLineProps) {
  return (
    <div className="rounded-control border border-line-soft bg-sunken px-3 py-[9px] font-mono text-small break-all text-accent-bright">
      {command}
      {result && ` → ${result}`}
    </div>
  )
}
