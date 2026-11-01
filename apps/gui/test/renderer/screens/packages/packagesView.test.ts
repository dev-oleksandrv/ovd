import { describe, expect, test } from 'vitest'
import {
  inspectedBuild,
  rowTags,
  sizeText,
  whenText
} from '../../../../src/renderer/src/screens/packages/packagesView'
import { aarch64Build, armv7Build, armv7Info, droppedInfo } from './sample'

describe('packagesView', () => {
  test.each([
    [512, '512 B'],
    [4_200, '4 KB'],
    [1_459_188, '1.5 MB'],
    [18_400_000, '18.4 MB']
  ])('sizeText(%d)', (bytes, text) => {
    expect(sizeText(bytes)).toBe(text)
  })

  test('whenText shows the time today and the date before', () => {
    const now = new Date(2026, 10, 1, 18, 0)
    expect(whenText(new Date(2026, 10, 1, 14, 2).toISOString(), now)).toBe('14:02')
    expect(whenText(new Date(2026, 9, 12, 9, 0).toISOString(), now)).toBe('Oct 12')
  })

  test('a row shows its folder’s hints until the package is read', () => {
    expect(rowTags(aarch64Build, undefined)).toEqual({ arch: 'aarch64', type: 'Debug' })
    // A pure-JS package built into armv7-release/ installs anywhere.
    expect(rowTags(armv7Build, { ...armv7Info, architecture: 'any' })).toEqual({
      arch: 'any',
      type: 'Release'
    })
    expect(
      rowTags({ ...armv7Build, folderArch: undefined, folderBuildType: undefined }, undefined)
    ).toEqual({
      arch: null,
      type: null
    })
  })

  test('a dropped file is listed under its folder', () => {
    expect(inspectedBuild(droppedInfo)).toMatchObject({
      file: 'hellovega_armv7.vpkg',
      folder: '~/Downloads/',
      size: droppedInfo.size
    })
  })
})
