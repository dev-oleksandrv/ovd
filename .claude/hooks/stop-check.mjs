// Stop hook: before the agent ends a turn that changed code, run `pnpm run check`.
// On failure the agent is sent back once with the tail of the output (exit 2).
// Docs-only turns, and code already checked green in this exact state, stop at once.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CODE_DIRS = ['apps/', 'packages/', 'e2e/', 'scripts/']
const ROOT_CONFIGS = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'eslint.config.mjs',
  '.prettierrc.yaml',
  '.prettierignore',
  'tsconfig.base.json'
]
const TAIL_LINES = 40

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

const input = readInput()
// Already sent back once this turn: let it stop, the failure is in the transcript.
if (input.stop_hook_active === true) process.exit(0)

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()

function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', ...options })
  return result.status === 0 ? result.stdout : null
}

function isCode(path) {
  return (
    CODE_DIRS.some((dir) => path.startsWith(dir)) ||
    ROOT_CONFIGS.includes(path) ||
    /^vitest\.config\.[cm]?[jt]s$/.test(path)
  )
}

// Paths changed in the working tree (staged, unstaged, untracked), from `git status -z`.
function workingTreeChanges() {
  const out = git(['status', '--porcelain', '-z', '--untracked-files=all'])
  if (out === null) return []
  const entries = out.split('\0').filter(Boolean)
  const paths = []
  for (let i = 0; i < entries.length; i++) {
    const status = entries[i].slice(0, 2)
    paths.push(entries[i].slice(3))
    // Renames and copies carry the original path as the next entry.
    if (status.includes('R') || status.includes('C')) paths.push(entries[++i] ?? '')
  }
  return paths
}

// Paths the branch changed against main (committed work not yet merged).
function branchChanges() {
  for (const base of ['main', 'origin/main']) {
    const out = git(['diff', '--name-only', `${base}...HEAD`])
    if (out !== null) return out.split('\n').filter(Boolean)
  }
  return []
}

const touched = [...workingTreeChanges(), ...branchChanges()].filter(isCode)
if (touched.length === 0) process.exit(0)

// Content hash of every code path as it is on disk now, through a throwaway index so the
// real one is never touched. Same hash as the last green run: nothing to check again.
function codeFingerprint() {
  const indexPath = git(['rev-parse', '--path-format=absolute', '--git-path', 'index'])?.trim()
  if (!indexPath) return null
  const scratch = mkdtempSync(join(tmpdir(), 'ovd-stop-check-'))
  try {
    const tempIndex = join(scratch, 'index')
    // A copy keeps git's stat cache, so only changed files are hashed again.
    if (existsSync(indexPath)) copyFileSync(indexPath, tempIndex)
    const env = { ...process.env, GIT_INDEX_FILE: tempIndex }
    if (git(['add', '-A'], { env }) === null) return null
    const tree = git(['write-tree'], { env })?.trim()
    if (!tree) return null
    const listing = git(['ls-tree', '-r', tree])
    if (listing === null) return null
    const code = listing
      .split('\n')
      .filter((line) => isCode(line.slice(line.indexOf('\t') + 1)))
      .join('\n')
    return createHash('sha256').update(code).digest('hex')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const markerPath = git([
  'rev-parse',
  '--path-format=absolute',
  '--git-path',
  'ovd-stop-check-green'
])?.trim()
const fingerprint = codeFingerprint()
if (
  fingerprint &&
  markerPath &&
  existsSync(markerPath) &&
  readFileSync(markerPath, 'utf8').trim() === fingerprint
) {
  process.exit(0)
}

// Through sh so stdout and stderr interleave in the order they were written.
const check = spawnSync('sh', ['-c', 'pnpm run check 2>&1'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
})

if (check.status === 0) {
  if (fingerprint && markerPath) writeFileSync(markerPath, `${fingerprint}\n`)
  process.exit(0)
}

const output = `${check.stdout ?? ''}${check.stderr ?? ''}`.trimEnd() || check.error?.message || ''
const tail = output.split('\n').slice(-TAIL_LINES).join('\n')
process.stderr.write(
  `\`pnpm run check\` failed after this turn's changes (${touched.length} code path(s) differ from main). ` +
    `Fix it before stopping, or tell the maintainer why it can't pass. Last ${TAIL_LINES} lines:\n${tail}\n`
)
process.exit(2)
