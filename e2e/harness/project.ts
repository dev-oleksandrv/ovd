import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// The project files of the helloWorld template the vega-project-doctor fixtures were recorded
// with (`vega project generate -t helloWorld --packageId com.example.hellovega`), trimmed to
// what OVD reads. These are the user's files, not SDK output.
export const MANIFEST = `schema-version = 1

[package]
title = "Basic UI React Native Application for project hellovega"
version = "0.1.0"
id = "com.example.hellovega"

[os.version]
min = "1.2"
target = "1.2"
`
const PACKAGE_JSON = `${JSON.stringify(
  { name: '@amazon-devices/hellovega', dependencies: { 'react-native': '0.83.0' } },
  null,
  2
)}\n`

// The broken manifest the `failed` fixture was recorded with.
export const BROKEN_MANIFEST = MANIFEST.replace('min = "1.2"', 'min = "9.9"')

// Writes a project folder under the sandbox home and returns its path.
export function makeProject(
  home: string,
  name = 'hellovega',
  files: { manifest?: string | null; packageJson?: string | null } = {}
): string {
  const folder = join(home, 'dev', name)
  mkdirSync(folder, { recursive: true })
  const manifest = files.manifest === undefined ? MANIFEST : files.manifest
  const pkg = files.packageJson === undefined ? PACKAGE_JSON : files.packageJson
  if (manifest !== null) writeFileSync(join(folder, 'manifest.toml'), manifest)
  if (pkg !== null) writeFileSync(join(folder, 'package.json'), pkg)
  return folder
}

// A file named like a build that vpt can't read: the fake SDK answers only for recorded ones.
export function makeVpkg(home: string, name = 'player-1.4.2-armv7.vpkg'): string {
  const file = join(home, 'Downloads', name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, 'not a real package')
  return file
}

// The sample packages the vpt fixtures were recorded from (fixtures/0.24/README.md).
export type RecordedPackage =
  'player-armv7-release' | 'player-aarch64-debug' | 'hellovega-armv7-release'

// A package the fake SDK answers for with that recording; `path` is relative to the home.
export function makeRecordedVpkg(
  home: string,
  path: string,
  recording: RecordedPackage,
  modified?: Date
): string {
  const file = join(home, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `fake-vpkg:${recording}\n`)
  if (modified) utimesSync(file, modified, modified)
  return file
}
