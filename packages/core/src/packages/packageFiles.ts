export interface FileNode {
  name: string
  // The full path inside the package, as `vpt show-contents` printed it (folders without a
  // trailing slash).
  path: string
  kind: 'folder' | 'file'
  children?: FileNode[]
}

export const MAX_ENTRIES = 10_000

// `vpt show-contents` lists files only, in archive order (ARCHITECTURE §8). The tree is built
// here so the CLI and the desktop show the same one: folders from the path segments, folders
// before files, each level by name. A path that isn't a plain relative path (a leading `/`, a
// backslash, an empty, `.` or `..` segment) isn't split: it stays a top-level file under its
// full text, so nothing in the list is hidden or moved.
export function buildFileTree(entries: string[]): FileNode[] {
  const root: FileNode = { name: '', path: '', kind: 'folder', children: [] }
  for (const entry of entries) {
    const segments = entry.split('/')
    const plain =
      !entry.includes('\\') && segments.every((s) => s !== '' && s !== '.' && s !== '..')
    if (!plain) {
      add(root, { name: entry, path: entry, kind: 'file' })
      continue
    }
    let folder = root
    segments.forEach((name, index) => {
      const path = segments.slice(0, index + 1).join('/')
      if (index === segments.length - 1) {
        add(folder, { name, path, kind: 'file' })
        return
      }
      const existing = folder.children?.find((c) => c.kind === 'folder' && c.name === name)
      if (existing) {
        folder = existing
        return
      }
      const created: FileNode = { name, path, kind: 'folder', children: [] }
      add(folder, created)
      folder = created
    })
  }
  return sorted(root.children ?? [])
}

function add(folder: FileNode, node: FileNode): void {
  // A file listed twice is shown once.
  if (folder.children?.some((c) => c.kind === node.kind && c.name === node.name)) return
  folder.children?.push(node)
}

function sorted(nodes: FileNode[]): FileNode[] {
  return [...nodes]
    .sort((a, b) =>
      a.kind === b.kind
        ? a.name < b.name
          ? -1
          : a.name > b.name
            ? 1
            : 0
        : a.kind === 'folder'
          ? -1
          : 1
    )
    .map((node) => (node.children ? { ...node, children: sorted(node.children) } : node))
}
