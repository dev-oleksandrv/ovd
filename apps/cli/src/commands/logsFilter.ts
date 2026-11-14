import { Option, type Command } from 'commander'
import {
  escapeControls,
  OvdError,
  type LogFilterInput,
  type Ovd,
  type ProcessRuleInput
} from '@ovd/core'
import { filterSummary } from '../format/logsFilter.js'
import type { CliDeps } from '../program.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

// The filter flags of `ovd logs`, `ovd logs filter save` and `ovd logs bundle` (ADR 0026):
//   --app --system --level --since --until --grep --regex      (the basic filter)
//   --pid --tid --tag --identity --facility --boot             (repeatable: OR within one flag)
//   --process-level <identity>=<level>  --process-rate <identity>=<n>  --mute <identity>
//   --preset <name>                    (a built-in preset or a saved filter; flags override it)
// Core validates every value (INVALID_LOG_FILTER, exit 2); this file only gathers them.

export interface FilterFlags {
  app?: string
  system?: boolean
  level?: string
  since?: string
  until?: string
  grep?: string
  regex?: boolean
  pid?: string[]
  tid?: string[]
  tag?: string[]
  identity?: string[]
  facility?: string[]
  boot?: string[]
  processLevel?: string[]
  processRate?: string[]
  mute?: string[]
  preset?: string
}

// A repeatable option's accumulator: commander passes the previous value.
function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value]
}

// Adds the filter flags to `command`. `--preset` is separate (`addPresetOption`): a bundle
// records the preset's name, so it passes it to core instead of resolving it.
export function addFilterOptions<C extends Command>(command: C): C {
  command
    .addOption(
      new Option('--app <id>', 'only the lines of this app (package ID)').conflicts('system')
    )
    .option('--system', 'only the lines of system processes')
    .option(
      '--level <level>',
      'minimum level: verbose, debug, info, warn, error (or v, d, i, w, e)'
    )
    .option('--since <time>', 'only lines from this time: ISO date-time, HH:MM[:SS] or 30s, 5m, 2h')
    .option('--until <time>', 'only lines until this time: same forms as --since')
    .option('--grep <text>', 'only lines whose message or tag contains this text')
    .option('--regex', 'treat --grep as a regular expression')
    .option('--pid <pid>', 'only this process ID (repeatable)', collect)
    .option('--tid <tid>', 'only this thread ID (repeatable)', collect)
    .option('--tag <tag>', 'only this exact tag (repeatable)', collect)
    .option('--identity <name>', 'only this syslog identity (repeatable)', collect)
    .option('--facility <facility>', 'only this syslog facility (repeatable)', collect)
    .option(
      '--boot <id>',
      'only this boot: a boot ID or "current" for the boot now running (repeatable)',
      collect
    )
    .option(
      '--process-level <identity=level>',
      'minimum level for one process (repeatable)',
      collect
    )
    .option(
      '--process-rate <identity=n>',
      'show at most n lines per second of one process (repeatable)',
      collect
    )
    .option('--mute <identity>', 'hide one process (repeatable)', collect)
  return command
}

export function addPresetOption<C extends Command>(command: C): C {
  command.option(
    '--preset <name>',
    'start from a built-in preset or a saved filter (see: ovd logs filter list); flags override it'
  )
  return command
}

function invalid(message: string, hint: string): OvdError {
  return new OvdError('INVALID_LOG_FILTER', message, hint)
}

// `identity=value` for the process flags; the value never holds `=`, an identity may.
function splitRule(flag: string, text: string): [string, string] {
  const at = text.lastIndexOf('=')
  if (at <= 0 || at === text.length - 1) {
    throw invalid(
      `${flag} takes <identity>=<value>, not ${JSON.stringify(escapeControls(text).slice(0, 80))}`,
      `For example ${flag} com.example.player=${flag === '--process-rate' ? '10' : 'warn'}`
    )
  }
  return [text.slice(0, at), text.slice(at + 1)]
}

// One rule per identity, in the order the identities first appear, so the three flags of one
// process combine into one rule (a process can be limited and raised at once).
export function processRulesOf(flags: FilterFlags): ProcessRuleInput[] {
  const rules = new Map<string, ProcessRuleInput>()
  const rule = (identity: string): ProcessRuleInput => {
    let existing = rules.get(identity)
    if (!existing) {
      existing = { identity }
      rules.set(identity, existing)
    }
    return existing
  }
  for (const text of flags.processLevel ?? []) {
    const [identity, level] = splitRule('--process-level', text)
    rule(identity).level = level
  }
  for (const text of flags.processRate ?? []) {
    const [identity, rate] = splitRule('--process-rate', text)
    rule(identity).rate = rate
  }
  for (const identity of flags.mute ?? []) rule(identity).mute = true
  return [...rules.values()]
}

// The filter the flags name, without `--preset`: only what the user gave.
export function filterOf(flags: FilterFlags): LogFilterInput {
  const rules = processRulesOf(flags)
  return {
    ...(flags.app === undefined ? {} : { app: flags.app }),
    ...(flags.system ? { system: true } : {}),
    ...(flags.level === undefined ? {} : { level: flags.level }),
    ...(flags.since === undefined ? {} : { since: flags.since }),
    ...(flags.until === undefined ? {} : { until: flags.until }),
    ...(flags.grep === undefined ? {} : { search: flags.grep }),
    ...(flags.regex ? { regex: true } : {}),
    ...(flags.pid ? { pid: flags.pid } : {}),
    ...(flags.tid ? { tid: flags.tid } : {}),
    ...(flags.tag ? { tag: flags.tag } : {}),
    ...(flags.identity ? { identity: flags.identity } : {}),
    ...(flags.facility ? { facility: flags.facility } : {}),
    ...(flags.boot ? { boot: flags.boot } : {}),
    ...(rules.length > 0 ? { processRules: rules } : {})
  }
}

// The flags with `--preset` resolved by core: the preset is the base, the flags override it
// field by field.
export async function resolveFilter(ovd: Ovd, flags: FilterFlags): Promise<LogFilterInput> {
  const explicit = filterOf(flags)
  return flags.preset === undefined ? explicit : ovd.logFilters.resolve(flags.preset, explicit)
}

// The flags of a subcommand of `ovd logs`. Commander hands the options it knows to `logs`
// itself before it routes to the subcommand (the program's own options are not positional), so
// `ovd logs bundle --level warn` is read by `logs`: the subcommand's flags are the ones
// `optsWithGlobals` merges back from there.
export function flagsOf<T extends FilterFlags>(cmd: Command): T {
  return cmd.optsWithGlobals<T>()
}

// `ovd logs filter save|list|rm` (F22): saved filters live on the host, not per device.
export function registerLogsFilter(
  logs: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  const filter = logs.command('filter').description('Saved log filters')

  addPresetOption(
    addFilterOptions(
      filter
        .command('save')
        .description('Save the filter flags under a name (use it with: ovd logs --preset <name>)')
        .argument('<name>', 'lower-case letters, digits and hyphens, up to 40 characters')
    )
  )
    .option('--force', 'replace a saved filter of this name')
    .action(async (name: string, _opts: object, cmd: Command) => {
      const flags = flagsOf<FilterFlags & { force?: boolean }>(cmd)
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(
        ctx,
        async () => {
          const input = await resolveFilter(deps.ovd(), flags)
          return deps.ovd().logFilters.save(name, input, { force: flags.force === true })
        },
        {
          json: (saved) => ({ filter: { name: saved.name, filter: saved.filter } }),
          human: (saved) =>
            `Saved filter ${escapeControls(saved.name)}: ${filterSummary(saved.filter)}\n` +
            `Use it with: ovd logs --preset ${escapeControls(saved.name)}\n`
        }
      )
    })

  filter
    .command('list')
    .description('List the built-in presets and the saved filters')
    .action(async (_flags: object, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(
        ctx,
        async () => {
          const ovd = deps.ovd()
          return { presets: ovd.logs.presets(), filters: await ovd.logFilters.list() }
        },
        {
          json: ({ presets, filters }) => ({
            presets: presets.map((p) => ({ name: p.key, label: p.label, builtin: true })),
            filters
          }),
          human: ({ presets, filters }) => {
            const lines = ['Presets:']
            for (const p of presets) lines.push(`  ${p.key}  ${p.label}`)
            lines.push('', 'Saved filters:')
            if (filters.length === 0) {
              lines.push('  none (save one with: ovd logs filter save <name>)')
            }
            for (const f of filters) {
              const name = escapeControls(f.name)
              lines.push(
                f.valid
                  ? `  ${name}  ${filterSummary(f.filter)}`
                  : `  ${name}  invalid: ${f.error.code}: ${escapeControls(f.error.message)}`
              )
            }
            return `${lines.join('\n')}\n`
          }
        }
      )
    })

  filter
    .command('rm')
    .description('Remove a saved filter')
    .argument('<name>', 'the saved filter')
    .action(async (name: string, _flags: object, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(ctx, () => deps.ovd().logFilters.remove(name), {
        json: (removed) => ({ name: removed.name }),
        human: (removed) => `Removed filter ${escapeControls(removed.name)}\n`
      })
    })
}
