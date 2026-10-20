import { join } from 'node:path'

// One directory shared by every surface, the same on macOS and Ubuntu (ADR 0022).
export function resolveOvdHome(env: Record<string, string | undefined>, homedir: string): string {
  if (env.OVD_HOME) return env.OVD_HOME
  return join(env.XDG_CONFIG_HOME || join(homedir, '.config'), 'ovd')
}
