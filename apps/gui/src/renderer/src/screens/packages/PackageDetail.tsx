import type { ArchCheck, PackageInfo } from '@ovd/core'
import { BlockedNotice } from '../../ui/BlockedNotice'
import { Button } from '../../ui/Button'
import { CodeBlock } from '../../ui/CodeBlock'
import { Icon } from '../../ui/Icon'
import { KeyValueGrid } from '../../ui/KeyValueGrid'
import { Tabs } from '../../ui/Tabs'
import { fixLabel, overviewRows } from './packagesView'

export interface InstallControl {
  onInstall: () => void
  installing: boolean
  // Why the target can't take an install (none, offline…); null when it can.
  disabledReason: string | null
  // The guard's answer for this package on the target, once known.
  check?: ArchCheck
  onFix: (check: ArchCheck) => void
}

interface PackageDetailProps {
  info: PackageInfo
  install: InstallControl
}

// Only Overview ships in Stage 2.2; Manifest, Files and Validate come in 5.3 (ADR 0018).
export function PackageDetail({ info, install }: PackageDetailProps) {
  const { check } = install
  const blocked = check !== undefined && !check.allowed
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
            // A blocked install stays clickable: the click says why (design `installPkg`).
            variant={blocked ? 'blocked' : 'primary'}
            onClick={install.onInstall}
            loading={install.installing}
            disabled={install.disabledReason !== null}
            {...(install.disabledReason === null ? {} : { disabledReason: install.disabledReason })}
          >
            Install on target
          </Button>
        </div>
        {blocked && (
          <BlockedNotice action={{ label: fixLabel(check), onClick: () => install.onFix(check) }}>
            {check.verdict === 'unknown' ? (
              <>
                Architecture unknown: the package has native code for several or unrecognized
                architectures, {check.target.name} is{' '}
                <b className="font-mono">{check.target.architecture}</b>. Install is blocked.
              </>
            ) : (
              <>
                Architecture mismatch: package is{' '}
                <b className="font-mono">{check.package.architecture}</b>, {check.target.name} is{' '}
                <b className="font-mono">{check.target.architecture}</b>. Install is blocked.
              </>
            )}
          </BlockedNotice>
        )}
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
