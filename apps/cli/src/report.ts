import { isOvdError, toErrorJson, type OvdError } from '@ovd/core'
import { exitCodeFor } from './exitCodes.js'
import type { Output } from './program.js'

export interface ReportContext {
  output: Output
  json: boolean
  setExitCode(code: number): void
}

export interface Render<T> {
  json(value: T): object
  human(value: T): string
  // A result core returns but that is still a failure (an unverified launch): it prints as an
  // error, with the result next to it, and exits with the error's code.
  failure?(value: T): OvdError | undefined
  // Its human text on stderr; by default the error's message and hint.
  failureHuman?(value: T): string
}

// Runs one command's core call and prints the result or the error (ADR 0006): in JSON mode
// stdout carries exactly one document, errors included.
export async function report<T>(
  ctx: ReportContext,
  action: () => Promise<T>,
  render: Render<T>
): Promise<void> {
  let value: T
  try {
    value = await action()
  } catch (error) {
    const body = isOvdError(error)
      ? toErrorJson(error)
      : {
          code: 'UNEXPECTED_ERROR',
          message: error instanceof Error ? error.message : String(error),
          hint: 'This is a bug in OVD. Please report it with the command you ran'
        }
    if (ctx.json) ctx.output.stdout(`${JSON.stringify({ ok: false, error: body })}\n`)
    else ctx.output.stderr(`Error: ${body.message}\n${body.hint}\n`)
    ctx.setExitCode(isOvdError(error) ? exitCodeFor(error.code) : 1)
    return
  }
  const failed = render.failure?.(value)
  if (failed) {
    if (ctx.json) {
      const doc = { ok: false, error: toErrorJson(failed), ...render.json(value) }
      ctx.output.stdout(`${JSON.stringify(doc)}\n`)
    } else {
      ctx.output.stderr(
        render.failureHuman?.(value) ?? `Error: ${failed.message}\n${failed.hint}\n`
      )
    }
    ctx.setExitCode(exitCodeFor(failed.code))
    return
  }
  if (ctx.json) ctx.output.stdout(`${JSON.stringify({ ok: true, ...render.json(value) })}\n`)
  else ctx.output.stdout(render.human(value))
}
