#!/usr/bin/env node
// Fails when the versioned docs drift from the repo: dead paths, an ADR index out of step,
// core folders missing from ARCHITECTURE §2, unknown `pnpm run` scripts, rule globs that match
// nothing, hook commands pointing at missing files. Prints one line on success.
// Usage: node scripts/check-docs.mjs (or pnpm run check:docs)
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const warnings = []

function fail(file, line, message, fix) {
  errors.push(`${file}:${line}: ${message}\n  fix: ${fix}`)
}

function read(file) {
  return readFileSync(join(root, file), 'utf8')
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

/** Tracked and untracked-but-not-ignored files, so a new file counts before it's committed. */
const repoFiles = git('ls-files', '--cached', '--others', '--exclude-standard')
  .split('\n')
  .filter(Boolean)
  .filter((file) => existsSync(join(root, file)))

// ---------------------------------------------------------------------------------------------
// 1. Backticked repo paths in versioned docs exist.

/**
 * Paths the docs mention on purpose that don't exist in a clean checkout. Each needs a reason.
 * Add an entry only when the path is right and simply not in the tree; otherwise fix the doc.
 */
const allowedPaths = new Map([
  ['apps/mcp', 'the MCP server surface, planned for Stage 7 (ADR 0017)'],
  ['apps/cli/dist', 'build output of the CLI, created by `pnpm run build`'],
  ['apps/gui/out', 'build output of the desktop app, created by `pnpm run build`'],
  ['e2e/test-results/', 'Playwright output, created by a failed desktop e2e run'],
  ['docs/superpowers/', 'gitignored working specs and plans (CLAUDE.md, Git)'],
  ['../ovd-notes', "the maintainer's notes folder, outside the repo"],
  ['.claude/settings.local.json', 'per-user Claude Code settings, gitignored'],
  ['assets/raw/keplerscript-app-config.json', 'a file inside a .vpkg, not in this repo'],
  ['.cursor/mcp.json', "an editor's MCP config in the user's project (Stage 7)"],
  ['.kiro/settings/mcp.json', "an editor's MCP config in the user's project (Stage 7)"],
  ['.github/workflows/vega-smoke.yml', "a workflow in the user's repo, from the Action (Stage 7)"],
  ['start/stop-log-stream', 'prose for the SDK commands start-log-stream and stop-log-stream'],
  ['start/stop-port-forwarding', 'prose for start-port-forwarding and stop-port-forwarding'],
  ['changesets/action', 'a GitHub Action (owner/repo), not a repo path'],
  ['pnpm/action-setup', 'a GitHub Action (owner/repo), not a repo path'],
  ['actions/checkout', 'a GitHub Action (owner/repo), not a repo path'],
  ['actions/setup-node', 'a GitHub Action (owner/repo), not a repo path']
])

/** Rule files apply to a package, so their paths may be relative to it. */
const ruleBases = {
  '.claude/rules/architecture.md': ['packages/core'],
  '.claude/rules/cli.md': ['apps/cli'],
  '.claude/rules/gui.md': ['apps/gui'],
  '.claude/rules/sdk.md': ['packages/core'],
  '.claude/rules/testing.md': ['e2e']
}

const commitTypes = 'feat|fix|refactor|perf|test|docs|style|build|ci|chore|revert'
const branchName = new RegExp(`^((${commitTypes})/[a-z0-9-]+|changeset-release/main|origin/\\S+)$`)

function isDocFile(file) {
  if (!file.endsWith('.md')) return false
  if (!file.includes('/')) return true
  if (file.startsWith('docs/')) return !file.startsWith('docs/superpowers/')
  return file.startsWith('.claude/rules/') || file.startsWith('.claude/skills/')
}

/** A code span that names a repo path, or undefined for commands, placeholders and the like. */
function pathCandidate(span) {
  if (/\s/.test(span) || !span.includes('/')) return undefined
  if (/[<>*{}$|[\]()=,]/.test(span)) return undefined // placeholders, globs, code
  if (span.includes('://')) return undefined // URLs, deep links
  if (/^[/~@-]/.test(span)) return undefined // absolute and on-device paths, home, npm scopes, flags
  if (/^\d+\.\d+\.\d+\.\d+/.test(span) || /^[0-9a-f]*::?[0-9a-f]/i.test(span)) return undefined // IPs
  if (/^[A-Z][a-z]+\/[A-Z]/.test(span)) return undefined // prose like Debug/Release
  // A bare folder (`src/`, `build/`, `lib/`) names a folder of some package, project or .vpkg.
  if (/^[\w.-]+\/$/.test(span)) return undefined
  return span.replace(/:\d+(:\d+)?$/, '').replace(/#.*$/, '')
}

function exists(path, bases) {
  return bases.some((base) => existsSync(join(root, base, path)))
}

let pathCount = 0
const docFiles = repoFiles.filter(isDocFile)
for (const file of docFiles) {
  const bases = ['', dirname(file), ...(ruleBases[file] ?? [])]
  let fenced = false
  read(file)
    .split('\n')
    .forEach((text, i) => {
      if (/^\s*(```|~~~)/.test(text)) fenced = !fenced
      if (fenced) return
      for (const [, span] of text.matchAll(/`([^`\n]+)`/g)) {
        const path = pathCandidate(span)
        if (path === undefined || allowedPaths.has(path)) continue
        pathCount++
        if (exists(path, bases)) continue
        if (branchName.test(path)) continue
        fail(
          file,
          i + 1,
          `\`${path}\` doesn't exist (looked from the repo root${bases.length > 2 ? `, ${bases.slice(2).join(', ')}` : ''} and ${bases[1] || '.'})`,
          'correct the path, or add it to allowedPaths in scripts/check-docs.mjs with a reason'
        )
      }
    })
}

// ---------------------------------------------------------------------------------------------
// 2. The ADR files and the index in docs/adr/README.md agree.

const adrDir = 'docs/adr'
const adrIndexFile = `${adrDir}/README.md`
const adrFiles = readdirSync(join(root, adrDir)).filter((name) => /^\d{4}-.+\.md$/.test(name))
const adrIndex = new Map()
read(adrIndexFile)
  .split('\n')
  .forEach((text, i) => {
    const match = /^- \[(\d{4}) (.+)\]\((.+\.md)\)$/.exec(text)
    if (match) adrIndex.set(match[3], { number: match[1], title: match[2], line: i + 1 })
  })

for (const name of adrFiles) {
  const entry = adrIndex.get(name)
  const heading = /^# (\d{4})\. (.+)$/m.exec(read(`${adrDir}/${name}`))
  if (!heading) {
    fail(`${adrDir}/${name}`, 1, 'no `# NNNN. Title` heading', 'start the ADR with `# NNNN. Title`')
    continue
  }
  if (!entry) {
    fail(
      adrIndexFile,
      1,
      `${name} is missing from the index`,
      `add \`- [${heading[1]} ${heading[2]}](${name})\` to ## Index`
    )
    continue
  }
  if (entry.number !== heading[1] || !name.startsWith(heading[1])) {
    fail(adrIndexFile, entry.line, `${name}: number differs from its file or heading`, 'renumber')
  }
  if (entry.title !== heading[2]) {
    fail(
      adrIndexFile,
      entry.line,
      `${name}: index title "${entry.title}" differs from the heading "${heading[2]}"`,
      'use the same title in both'
    )
  }
}
for (const [name, entry] of adrIndex) {
  if (!adrFiles.includes(name)) {
    fail(adrIndexFile, entry.line, `index links ${name}, which doesn't exist`, 'fix the link')
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Every folder in packages/core/src/ is listed in ARCHITECTURE §2, and every listed folder
//    that doesn't exist yet is marked with its stage.

const architectureFile = 'docs/ARCHITECTURE.md'
const architecture = read(architectureFile).split('\n')
const s2Start = architecture.findIndex((text) => text.startsWith('## 2.'))
const s2End = architecture.findIndex((text, i) => i > s2Start && text.startsWith('## '))
const coreSrc = 'packages/core/src'
const listed = new Map()
let inCoreSrc = false
for (let i = s2Start; i < s2End; i++) {
  const text = architecture[i]
  if (/^ {4}src\/(\s|$)/.test(text)) inCoreSrc = true
  else if (inCoreSrc && !/^ {6}/.test(text)) inCoreSrc = false
  const folder = inCoreSrc && /^ {6}([\w-]+)\/\s/.exec(text)
  if (folder) listed.set(folder[1], { line: i + 1, planned: /\(Stage [\d.–-]+\)/.test(text) })
}
const coreFolders = readdirSync(join(root, coreSrc)).filter((name) =>
  statSync(join(root, coreSrc, name)).isDirectory()
)
for (const name of coreFolders) {
  if (!listed.has(name)) {
    fail(
      architectureFile,
      s2Start + 1,
      `${coreSrc}/${name}/ isn't listed in §2`,
      `add \`${name}/  # <what it holds>\` under core/src/`
    )
  } else if (listed.get(name).planned) {
    fail(
      architectureFile,
      listed.get(name).line,
      `${name}/ exists but is marked as planned`,
      'drop the (Stage …) marker'
    )
  }
}
for (const [name, entry] of listed) {
  if (!coreFolders.includes(name) && !entry.planned) {
    fail(
      architectureFile,
      entry.line,
      `${coreSrc}/${name}/ doesn't exist`,
      'mark it planned with its stage, e.g. `(Stage 3)`, or remove it'
    )
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Every `pnpm run <x>` in the entry docs is a root script.

const scripts = Object.keys(JSON.parse(read('package.json')).scripts ?? {})
for (const file of ['CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md', 'README.md']) {
  if (!existsSync(join(root, file))) continue
  read(file)
    .split('\n')
    .forEach((text, i) => {
      for (const [, name] of text.matchAll(/pnpm run ([\w:.-]+)/g)) {
        if (!scripts.includes(name)) {
          fail(
            file,
            i + 1,
            `\`pnpm run ${name}\` isn't a root script`,
            'use a script from package.json, or add it there'
          )
        }
      }
    })
}

// ---------------------------------------------------------------------------------------------
// 5. Every `paths:` glob in .claude/rules/*.md matches a file.

function globToRegExp(glob) {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === '*' && glob[i + 1] === '*') {
      source += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'
      i += glob[i + 2] === '/' ? 2 : 1
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`)
}

const rulesDir = '.claude/rules'
for (const name of readdirSync(join(root, rulesDir)).filter((n) => n.endsWith('.md'))) {
  const file = `${rulesDir}/${name}`
  const lines = read(file).split('\n')
  if (lines[0] !== '---') continue
  const end = lines.indexOf('---', 1)
  for (let i = 1; i < end; i++) {
    const glob = /^\s+-\s+['"]?([^'"]+)['"]?\s*$/.exec(lines[i])?.[1]
    if (glob && !repoFiles.some((path) => globToRegExp(glob).test(path))) {
      fail(file, i + 1, `paths glob '${glob}' matches no file`, 'fix the glob or remove it')
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 6. Every hook command in .claude/settings.json points at a file that exists.

const settingsFile = '.claude/settings.json'
if (existsSync(join(root, settingsFile))) {
  const settingsText = read(settingsFile)
  const hooks = JSON.parse(settingsText).hooks ?? {}
  for (const command of Object.values(hooks)
    .flat()
    .flatMap((matcher) => matcher.hooks ?? [])
    .map((hook) => hook.command)
    .filter((command) => typeof command === 'string')) {
    const expanded = command.replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, root)
    for (const [, token] of expanded.matchAll(/["']?([^\s"']+\.(?:mjs|cjs|js|ts|sh|py))["']?/g)) {
      const path = token.startsWith('/') ? token : join(root, token)
      if (!existsSync(path)) {
        const line = settingsText.slice(0, settingsText.indexOf(command)).split('\n').length
        fail(
          settingsFile,
          line,
          `hook command points at ${relative(root, path)}, which doesn't exist`,
          'fix the path in the command, or add the script'
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 7. Nudge only: commit scopes in recent history are packages listed in CONTRIBUTING.md.

const scopeLine = read('CONTRIBUTING.md')
  .split('\n')
  .find((text) => text.startsWith('- **Scope:**'))
const knownScopes = new Set(
  [...(scopeLine ?? '').matchAll(/`([a-z0-9-]+)`/g)].map(([, scope]) => scope)
)
let subjects = []
try {
  subjects = git('log', '-200', '--format=%s').split('\n')
} catch {
  // No history (e.g. an exported tree): nothing to nudge about.
}
const unknownScopes = new Set()
for (const subject of subjects) {
  const scopes = /^\w+\(([^)]+)\)!?:/.exec(subject)?.[1].split(',') ?? []
  for (const scope of scopes.map((s) => s.trim())) {
    if (!knownScopes.has(scope)) unknownScopes.add(scope)
  }
}
if (unknownScopes.size > 0) {
  warnings.push(
    `CONTRIBUTING.md: recent commits use scopes not listed under **Scope:**: ${[...unknownScopes].join(', ')}. Add the package there, or use a listed scope.`
  )
}

// ---------------------------------------------------------------------------------------------

for (const warning of warnings) console.warn(`warning: ${warning}`)
if (errors.length > 0) {
  console.error(errors.join('\n'))
  console.error(`check:docs: ${errors.length} problem(s)`)
  process.exit(1)
}
console.log(
  `check:docs: ok (${docFiles.length} docs, ${pathCount} paths, ${adrFiles.length} ADRs, ${coreFolders.length} core folders)`
)
