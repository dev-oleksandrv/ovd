interface StepListProps {
  steps: string[]
}

// Numbered on-device instructions inside a wizard step.
export function StepList({ steps }: StepListProps) {
  return (
    <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
      {steps.map((text, index) => (
        <li key={text} className="flex items-start gap-2.5">
          <span className="grid size-5 flex-none place-items-center rounded-full bg-selected font-mono text-label text-muted">
            {index + 1}
          </span>
          <span className="leading-normal text-text-soft">{text}</span>
        </li>
      ))}
    </ol>
  )
}
