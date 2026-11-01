import type { PackageInfo } from '@ovd/core'
import { Button } from '../../ui/Button'
import { CodeBlock } from '../../ui/CodeBlock'
import { Icon } from '../../ui/Icon'
import { KeyValueGrid } from '../../ui/KeyValueGrid'
import { Tabs } from '../../ui/Tabs'
import { overviewRows } from './packagesView'

interface PackageDetailProps {
  info: PackageInfo
}

// Only Overview ships in Stage 2.2; Manifest, Files and Validate come in 5.3 (ADR 0018).
export function PackageDetail({ info }: PackageDetailProps) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-3.5 border-b border-line px-6 pt-5">
        <div className="flex items-center gap-3.5">
          <div className="grid size-11 flex-none place-items-center rounded-palette bg-selected text-accent">
            <Icon name="deployed_code" size={24} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <h2 className="m-0 text-title font-semibold">
              {info.title}{' '}
              <span className="font-normal text-muted">
                {info.version} ({info.buildNumber})
              </span>
            </h2>
            <div className="font-mono text-meta break-all text-muted">{info.displayPath}</div>
          </div>
          <Button
            variant="primary"
            disabled
            disabledReason="Installing comes with the Apps screen in a later version"
          >
            Install on target
          </Button>
        </div>
        <Tabs
          items={[{ id: 'overview', label: 'Overview' }]}
          value="overview"
          onChange={() => {}}
        />
      </div>
      <div className="flex-1 overflow-auto px-6 py-5">
        <div className="flex max-w-[860px] flex-col gap-4">
          <KeyValueGrid items={overviewRows(info)} />
          <CodeBlock title="vpt info --json" code={JSON.stringify(info.vptInfo, null, 2)} />
        </div>
      </div>
    </div>
  )
}
