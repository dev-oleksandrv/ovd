#!/usr/bin/env node
// Prints the release notes for one version: its CLI and desktop CHANGELOG sections.
// Usage: node scripts/release-notes.mjs <version>
import { existsSync, readFileSync } from 'node:fs'

const version = process.argv[2]
if (!version) {
  console.error('Usage: node scripts/release-notes.mjs <version>')
  process.exit(2)
}

function section(file) {
  if (!existsSync(file)) return ''
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex((line) => line.trim() === `## ${version}`)
  if (start === -1) return ''
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim()
}

const parts = [
  ['CLI', section('apps/cli/CHANGELOG.md')],
  ['Desktop', section('apps/gui/CHANGELOG.md')]
].filter(([, body]) => body)

console.log(
  parts.length
    ? parts.map(([title, body]) => `## ${title}\n\n${body}`).join('\n\n')
    : `Release ${version}.`
)
