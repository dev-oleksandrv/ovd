import type { FolderProject, PackageBuild, PackageInfo } from '@ovd/core'

export const project: FolderProject = {
  kind: 'folder',
  path: '/home/dev/dev/player',
  displayPath: '~/dev/player',
  name: 'player'
}

export const armv7Build: PackageBuild = {
  path: '/home/dev/dev/player/build/armv7-release/player_armv7.vpkg',
  displayPath: '~/dev/player/build/armv7-release/player_armv7.vpkg',
  file: 'player_armv7.vpkg',
  folder: 'build/armv7-release/',
  size: 1459188,
  modifiedAt: '2026-11-01T14:02:00.000Z',
  folderArch: 'armv7',
  folderBuildType: 'release'
}

export const aarch64Build: PackageBuild = {
  ...armv7Build,
  path: '/home/dev/dev/player/build/aarch64-debug/player_aarch64.vpkg',
  displayPath: '~/dev/player/build/aarch64-debug/player_aarch64.vpkg',
  file: 'player_aarch64.vpkg',
  folder: 'build/aarch64-debug/',
  folderArch: 'aarch64',
  folderBuildType: 'debug'
}

export const armv7Info: PackageInfo = {
  path: armv7Build.path,
  displayPath: armv7Build.displayPath,
  file: armv7Build.file,
  id: 'com.example.player',
  title: 'Sample Player',
  version: '1.4.2',
  buildNumber: 142,
  size: 1459188,
  unpackedSize: 2817790,
  architecture: 'armv7',
  buildType: 'release',
  osVersions: ['1.2'],
  contractPackageVersion: '1.0.323.0',
  sha384: '0ee2046b',
  modifiedAt: armv7Build.modifiedAt,
  vptInfo: { title: 'Sample Player', id: 'com.example.player', build_number: 142 }
}

export const droppedInfo: PackageInfo = {
  ...armv7Info,
  path: '/home/dev/Downloads/hellovega_armv7.vpkg',
  displayPath: '~/Downloads/hellovega_armv7.vpkg',
  file: 'hellovega_armv7.vpkg',
  id: 'com.example.hellovega',
  title: 'Hello Vega',
  version: '0.1.0',
  buildNumber: 0,
  architecture: 'any'
}
