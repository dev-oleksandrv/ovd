import type { Command } from 'commander'
import type { CliDeps, GlobalOptions } from '../program.js'
import type { ReportContext } from '../report.js'

export function reportContext(
  cmd: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): ReportContext & GlobalOptions {
  const { json, device } = cmd.optsWithGlobals<GlobalOptions>()
  return {
    output: deps.output,
    json: json ?? false,
    ...(device === undefined ? {} : { device }),
    setExitCode
  }
}
