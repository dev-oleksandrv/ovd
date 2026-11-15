import { packageInvalid } from '@ovd/core'
import type { Command } from 'commander'
import type { CliDeps } from '../program.js'
import { filesText, invalidText, manifestText, validationText } from '../format/packageTabs.js'
import { buildsTable, packageRows } from '../format/packages.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

// Packages → Overview (Stage 2.2): read a .vpkg with vpt, list the open project's builds.
// Manifest, Files and Validate (Stage 5.3): the packaged manifest, its contents and vpt's check.
export function registerPkg(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  const pkg = program.command('pkg').description('Inspect .vpkg files')

  pkg
    .command('info')
    .description('Show a .vpkg’s ID, title, version, architecture and build type')
    .argument('[file]', '.vpkg file (default: the .vpkg open with ovd open)')
    .action(async (file: string | undefined, _opts, cmd: Command) => {
      await report(reportContext(cmd, deps, setExitCode), () => deps.ovd().packages.info(file), {
        json: (info) => ({ package: info }),
        human: packageRows
      })
    })

  pkg
    .command('manifest')
    .description('Show a .vpkg’s manifest.toml with line numbers and vpt validate’s notes')
    .argument('[file]', '.vpkg file (default: the .vpkg open with ovd open)')
    .action(async (file: string | undefined, _opts, cmd: Command) => {
      await report(
        reportContext(cmd, deps, setExitCode),
        () => deps.ovd().packages.manifest(file),
        { json: (manifest) => ({ manifest }), human: manifestText }
      )
    })

  pkg
    .command('files')
    .description('List the files in a .vpkg as a tree')
    .argument('[file]', '.vpkg file (default: the .vpkg open with ovd open)')
    .action(async (file: string | undefined, _opts, cmd: Command) => {
      await report(reportContext(cmd, deps, setExitCode), () => deps.ovd().packages.files(file), {
        json: (files) => ({ files }),
        human: filesText
      })
    })

  pkg
    .command('validate')
    .description('Validate a .vpkg with vpt (exit 1 when it has errors)')
    .argument('[file]', '.vpkg file (default: the .vpkg open with ovd open)')
    .action(async (file: string | undefined, _opts, cmd: Command) => {
      await report(
        reportContext(cmd, deps, setExitCode),
        () => deps.ovd().packages.validate(file),
        {
          json: (validation) => ({ validation }),
          human: validationText,
          failure: (validation) => (validation.valid ? undefined : packageInvalid(validation)),
          failureStdout: validationText,
          failureHuman: (validation) => invalidText(packageInvalid(validation))
        }
      )
    })

  pkg
    .command('list')
    .description('List the open project’s builds (build/), newest first')
    .action(async (_opts, cmd: Command) => {
      const ovd = deps.ovd()
      await report(
        reportContext(cmd, deps, setExitCode),
        async () => ({ mode: await ovd.project.current(), builds: await ovd.packages.builds() }),
        {
          json: ({ builds }) => ({ builds }),
          human: ({ mode, builds }) => {
            if (mode === null) {
              deps.output.stderr('Open one with: ovd open <folder|file.vpkg>\n')
              return 'No project open.\n'
            }
            if (builds.length === 0) {
              deps.output.stderr('Build one with: npm run build:debug\n')
              return 'No builds in build/.\n'
            }
            return buildsTable(builds)
          }
        }
      )
    })
}
