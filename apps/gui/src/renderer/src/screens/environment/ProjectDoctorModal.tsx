import type { ProjectDoctorReport } from '@ovd/core'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { Modal } from '../../ui/Modal'
import { toneText } from '../../ui/tone'
import { projectSummary, splitLink } from './projectDoctorView'
import { rowView } from './doctorView'

interface ProjectDoctorModalProps {
  name: string
  displayPath: string
  report: ProjectDoctorReport
  running: boolean
  onCopy: () => void
  onRerun: () => void
  onClose: () => void
}

const STATUS = { ok: 'ok', warn: 'warn', fail: 'fail' } as const

// Doctor → Project → Details: every `vega project doctor` check with its fix hints.
export function ProjectDoctorModal({
  name,
  displayPath,
  report,
  running,
  onCopy,
  onRerun,
  onClose
}: ProjectDoctorModalProps) {
  const summary = projectSummary(report)
  const summaryView = rowView(summary.status)
  return (
    <Modal
      size="lg"
      title={`Project doctor · ${name}`}
      subtitle={displayPath}
      subtitleMono
      onClose={onClose}
      footer={
        <>
          <Icon
            name={running ? 'progress_activity' : summaryView.icon}
            size={17}
            fill
            spin={running}
            className={running ? 'text-faint' : toneText[summaryView.tone]}
          />
          <div className="min-w-0 flex-1 text-prose">
            {running ? 'Running vega project doctor…' : summary.text}
          </div>
          <Button icon="content_copy" onClick={onCopy}>
            Copy output
          </Button>
          <Button variant="primary" icon="refresh" loading={running} onClick={onRerun}>
            {running ? 'Running…' : 'Re-run'}
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-5 py-4">
        <ul
          aria-label="Project checks"
          className="m-0 flex shrink-0 list-none flex-col overflow-hidden rounded-card border border-line-soft p-0"
        >
          {report.checks.map((check) => {
            const view = rowView(STATUS[check.status])
            return (
              <li
                key={check.name}
                className="flex items-start gap-3 border-b border-line-row bg-panel px-3.5 py-2.5 last:border-b-0"
              >
                <Icon name={view.icon} size={17} fill className={toneText[view.tone]} />
                <div className="w-[200px] flex-none text-compact font-medium">{check.name}</div>
                <div className="min-w-0 flex-1 text-compact leading-[1.45] text-pretty text-muted">
                  {check.message}
                </div>
              </li>
            )
          })}
        </ul>
        {report.fixes.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="text-label tracking-[0.06em] text-subtle uppercase">To fix</div>
            {report.fixes.map((fix) => {
              const { before, link, after } = splitLink(fix)
              return (
                <div key={fix} className="flex gap-2 text-compact leading-normal text-prose">
                  <span className="text-faint">•</span>
                  <div className="min-w-0 break-words">
                    {before}
                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline hover:text-accent-bright"
                      >
                        {link}
                      </a>
                    )}
                    {after}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
