import { isOvdError, toErrorJson } from '@ovd/core'
import { exitCodeFor } from './exitCodes.js'
import type { Output } from './program.js'

export interface ReportContext {
  output: Output
  json: boolean
  setExitCode(code: number): void
}

// Runs one command's core call and prints the result or the error (ADR 0006): in JSON mode
// stdout carries exactly one document, errors included.
export async function report<T>(
  ctx: ReportContext,
  action: () => Promise<T>,
  render: { json(value: T): object; human(value: T): string }
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
  if (ctx.json) ctx.output.stdout(`${JSON.stringify({ ok: true, ...render.json(value) })}\n`)
  else ctx.output.stdout(render.human(value))
}
