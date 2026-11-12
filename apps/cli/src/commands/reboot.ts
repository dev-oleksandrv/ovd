import { DEFAULT_REBOOT_TIMEOUT_MS, OvdError, type RebootProgress } from '@ovd/core'
import type { Command } from 'commander'
import { rebootedLine } from '../format/reboot.js'
import type { CliDeps } from '../program.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

interface RebootFlags {
  timeout?: string
}

// The deadline holds the 8 s settle, and the Virtual Device takes 15–20 s with it
// (docs/ARCHITECTURE.md §8).
const MIN_TIMEOUT_S = 30
const MAX_TIMEOUT_S = 600

function timeoutMs(value: string | undefined): number {
  if (value === undefined) return DEFAULT_REBOOT_TIMEOUT_MS
  const seconds = /^\d+$/.test(value) ? Number(value) : NaN
  if (!(seconds >= MIN_TIMEOUT_S && seconds <= MAX_TIMEOUT_S)) {
    throw new OvdError(
      'INVALID_TIMEOUT',
      `Invalid --timeout: ${value.slice(0, 40)}`,
      `Pass whole seconds from ${MIN_TIMEOUT_S} to ${MAX_TIMEOUT_S}`
    )
  }
  return seconds * 1000
}

// `ovd reboot [--timeout <seconds>]` (Stage 4.5): reboots the target and waits until it is
// back online. Progress goes to stderr; Ctrl+C stops the wait, not the reboot.
export function registerReboot(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  program
    .command('reboot')
    .description('Reboot the target and wait until it is back online')
    .option('--timeout <seconds>', `how long to wait, ${MIN_TIMEOUT_S}–${MAX_TIMEOUT_S} s`, '120')
    .action(async (flags: RebootFlags, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      await report(
        ctx,
        async () => {
          const ms = timeoutMs(flags.timeout)
          const ovd = deps.ovd()
          let waiting = false
          const progress = (step: RebootProgress, target: { id: string; name: string }) => {
            if (step === 'rebooting') deps.output.stderr(`Rebooting ${target.name}…\n`)
            if (step === 'waiting' && !waiting) {
              waiting = true
              deps.output.stderr(
                `Waiting for ${target.name} to come back (up to ${ms / 1000} s)…\n`
              )
            }
            if (step === 'reconnecting') {
              deps.output.stderr(`Reconnecting ${target.id} over Wi‑Fi…\n`)
            }
          }
          const controller = new AbortController()
          const dispose = deps.onInterrupt(() => controller.abort())
          try {
            return await ovd.reboot.reboot({
              ...(ctx.device === undefined ? {} : { device: ctx.device }),
              timeoutMs: ms,
              signal: controller.signal,
              onProgress: progress
            })
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              throw new OvdError('COMMAND_FAILED', 'Cancelled', 'The device may still be rebooting')
            }
            throw error
          } finally {
            dispose()
          }
        },
        { json: (result) => ({ reboot: result }), human: rebootedLine }
      )
    })
}
