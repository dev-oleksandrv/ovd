// PostToolUse hook (Edit|Write): lint the file the agent just changed, so a broken rule
// comes back in the same turn instead of at `pnpm run check`.
// Exit 0 = silent; exit 2 = stderr goes back to the agent as feedback.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const LINTED = /\.(ts|tsx|mts|cts|mjs|cjs)$/

function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

const input = readInput()
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
const filePath = input.tool_input?.file_path

if (typeof filePath !== 'string' || !LINTED.test(filePath)) process.exit(0)

const absolute = isAbsolute(filePath) ? filePath : resolve(root, filePath)
const inRepo = relative(root, absolute)
// Outside the repo, or deleted since: nothing of ours to lint.
if (inRepo.startsWith('..') || isAbsolute(inRepo) || !existsSync(absolute)) process.exit(0)

// --no-warn-ignored: files eslint.config.mjs ignores (dist, fixtures) pass quietly.
// --quiet: only errors block, as in `pnpm run lint`.
const result = spawnSync('pnpm', ['exec', 'eslint', '--quiet', '--no-warn-ignored', '--', inRepo], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
})

if (result.status === 0) process.exit(0)

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
if (result.status === 1) {
  process.stderr.write(`eslint found errors in ${inRepo}. Fix them before going on:\n${output}\n`)
  process.exit(2)
}

// eslint itself failed (config error, missing install): tell the user, don't block the agent on it.
process.stderr.write(
  `post-edit-lint: eslint could not run on ${inRepo}:\n${output || result.error?.message || ''}\n`
)
process.exit(1)
