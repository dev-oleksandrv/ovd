import type {
  PackageFiles,
  PackageManifestFile,
  PackageValidation,
  ValidationIssue
} from '@ovd/core'
import { armv7Info } from './sample'

// What core returns for the recorded broken sample (fixtures/0.24/vpt-validate), on the
// sample build's path.
const ref = { path: armv7Info.path, displayPath: armv7Info.displayPath, file: armv7Info.file }

const privilege = (name: string): ValidationIssue => ({
  severity: 'info',
  key: 'wants.module.id',
  message: `Kepler module dependency MAY require the privilege '${name}'`,
  file: 'manifest.toml',
  line: 27,
  column: 6
})

export const brokenValidation: PackageValidation = {
  ...ref,
  valid: false,
  errors: 3,
  warnings: 0,
  infos: 5,
  issues: [
    {
      severity: 'info',
      key: 'package.icon',
      message: 'Icon is not defined in the manifest. System default will be used.',
      file: 'manifest.toml',
      line: 3,
      column: 1,
      help: 'Define icon to help users recognize your application'
    },
    {
      severity: 'error',
      key: 'package.build-number',
      message: 'build-number must be greater than 0, found: 0',
      file: 'manifest.toml',
      line: 7,
      column: 16,
      help: 'Provide a positive integer for build-number'
    },
    {
      severity: 'error',
      key: 'components.interactive.launch-type',
      message: "'sometimes' launch type is not supported for 'interactive' component.",
      file: 'manifest.toml',
      line: 33,
      column: 15
    },
    privilege('com.amazon.network.privilege.net-info'),
    privilege('com.amazon.wifi.privilege.read-wifi-credential'),
    privilege('com.amazon.wifi.privilege.wifi-scan'),
    privilege('com.amazon.network.privilege.net-admin'),
    {
      severity: 'error',
      key: 'os.version',
      message: 'contains value(s) not in the OS Version registry.',
      help: '- min: \'9.9\' is not minted\nValid OS Versions: "1.2"'
    }
  ]
}

export const validValidation: PackageValidation = {
  ...ref,
  valid: true,
  errors: 0,
  warnings: 0,
  infos: 0,
  issues: []
}

export const manifestFile: PackageManifestFile = {
  ...ref,
  entry: 'manifest.toml',
  lines: Array.from({ length: 35 }, (_, i) =>
    i === 6 ? 'build-number = 0' : i === 32 ? 'launch-type = "sometimes"' : `line ${i + 1}`
  )
}

export const packageFiles: PackageFiles = {
  ...ref,
  entries: ['assets/raw/keplerscript-app-config.json', 'manifest.toml'],
  tree: [
    {
      name: 'assets',
      path: 'assets',
      kind: 'folder',
      children: [
        {
          name: 'raw',
          path: 'assets/raw',
          kind: 'folder',
          children: [
            {
              name: 'keplerscript-app-config.json',
              path: 'assets/raw/keplerscript-app-config.json',
              kind: 'file'
            }
          ]
        }
      ]
    },
    { name: 'manifest.toml', path: 'manifest.toml', kind: 'file' }
  ]
}
