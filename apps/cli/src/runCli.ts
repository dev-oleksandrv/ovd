import { CommanderError } from 'commander'
import { createProgram, type CliDeps } from './program.js'

// Parses argv and returns the exit code instead of exiting, so tests run the real program.
export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  let exitCode = 0
  const program = createProgram(deps, (code) => (exitCode = code))
  program.exitOverride()
  try {
    await program.parseAsync(argv, { from: 'user' })
  } catch (error) {
    // Help and version exit 0; every other commander error is a usage error (ARCHITECTURE §5).
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2
    throw error
  }
  return exitCode
}
