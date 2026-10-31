import type { Command } from 'commander'
import type { CliDeps } from '../program.js'
import { openedLine, projectLine } from '../format/project.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

// Project mode and no-project mode (Stage 2.1), shared with the desktop through the host state.
export function registerProject(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  program
    .command('open')
    .description('Open a Vega project folder, or a .vpkg to install without a project')
    .argument('<path>', 'project folder (with manifest.toml) or .vpkg file')
    .action(async (path: string, _opts, cmd: Command) => {
      await report(reportContext(cmd, deps, setExitCode), () => deps.ovd().project.open(path), {
        json: (project) => ({ project }),
        human: openedLine
      })
    })

  program
    .command('close')
    .description('Close the open project or .vpkg')
    .action(async (_opts, cmd: Command) => {
      await report(reportContext(cmd, deps, setExitCode), () => deps.ovd().project.close(), {
        json: () => ({ project: null }),
        human: () => 'No project open.\n'
      })
    })

  program
    .command('project')
    .description('Show the open project or .vpkg')
    .action(async (_opts, cmd: Command) => {
      await report(reportContext(cmd, deps, setExitCode), () => deps.ovd().project.current(), {
        json: (project) => ({ project }),
        human: (project) => {
          if (project === null) {
            deps.output.stderr('Open one with: ovd open <folder|file.vpkg>\n')
            return 'No project open.\n'
          }
          if (project.missing) deps.output.stderr('Open it again with: ovd open <path>\n')
          return projectLine(project)
        }
      })
    })
}
