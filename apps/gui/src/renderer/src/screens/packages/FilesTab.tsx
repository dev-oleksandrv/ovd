import type { PackageFiles, PackageValidation } from '@ovd/core'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { ErrorState } from '../../ui/ErrorState'
import { Icon } from '../../ui/Icon'
import { LoadingState } from '../../ui/LoadingState'
import { manifestErrors, treeRows, type Load } from './packageTabsView'

interface FilesTabProps {
  file: string
  files: Load<PackageFiles> | undefined
  validation: Load<PackageValidation> | undefined
  onRetry: () => void
  onOpenManifest: () => void
}

// Packages → Files (Stage 5.3): `vpt show-contents` as a tree (core builds it). vpt prints no
// sizes, so none are shown. `manifest.toml` carries Validate's error count and opens Manifest.
export function FilesTab({ file, files, validation, onRetry, onOpenManifest }: FilesTabProps) {
  if (files === undefined || files.status === 'loading') {
    return <LoadingState label={`Listing ${file}…`} />
  }
  if (files.status === 'error') {
    return (
      <ErrorState
        title={files.error.message}
        hint={files.error.hint}
        actions={<Button onClick={onRetry}>Retry</Button>}
      />
    )
  }
  if (files.data.entries.length === 0) {
    return (
      <EmptyState
        title="No files"
        body={`vpt show-contents listed no files in ${file}.`}
        actions={<Button onClick={onRetry}>List again</Button>}
      />
    )
  }
  const errors = manifestErrors(validation?.status === 'ready' ? validation.data : undefined)
  const n = files.data.entries.length
  return (
    <div className="flex flex-col gap-3">
      <div className="text-muted">
        {n} {n === 1 ? 'file' : 'files'}
      </div>
      <ul
        aria-label="Files"
        className="m-0 flex flex-col rounded-card border border-line bg-panel p-0 py-1.5"
      >
        {treeRows(files.data.tree).map(({ node, depth }) => {
          const manifest = node.kind === 'file' && node.path === 'manifest.toml'
          const body = (
            <>
              <Icon
                name={node.kind === 'folder' ? 'folder' : manifest ? 'description' : 'draft'}
                size={16}
                className={node.kind === 'folder' ? 'text-accent' : 'text-muted'}
              />
              <span className="min-w-0 truncate font-mono text-small">{node.name}</span>
              {manifest && errors > 0 && (
                <Badge tone="error">{`${errors} ${errors === 1 ? 'error' : 'errors'}`}</Badge>
              )}
            </>
          )
          return (
            <li
              key={`${node.kind}:${node.path}`}
              style={{ paddingLeft: `${0.75 + depth * 1.125}rem` }}
              className="flex list-none items-center gap-2 py-1 pr-3"
            >
              {manifest ? (
                <button
                  type="button"
                  onClick={onOpenManifest}
                  title="Open in Manifest"
                  className="flex min-w-0 cursor-pointer items-center gap-2 hover:text-accent"
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
