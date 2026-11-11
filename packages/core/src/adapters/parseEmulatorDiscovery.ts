import { z } from 'zod'
import { OvdError } from '../errors/ovdError.js'

export interface EmulatorDiscovery {
  consolePort: number
  grpcPort: number
  // `grpc.token`: the Bearer token gRPC calls need. Never logged, never returned from core.
  token: string
}

const port = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .refine((n) => n > 0 && n < 65_536)

const schema = z.object({
  'port.serial': port,
  'grpc.port': port,
  'grpc.token': z.string().min(1)
})

// The emulator's discovery file (`pid_<qemu pid>.ini`, `key=value` lines), written once
// `grpc <port>` turned the endpoint on (fixtures/0.24/emulator-discovery).
export function parseEmulatorDiscovery(text: string): EmulatorDiscovery {
  const values: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  const parsed = schema.safeParse(values)
  if (!parsed.success) {
    // No file content in the error: it holds the gRPC token.
    throw new OvdError(
      'UNEXPECTED_OUTPUT',
      'Could not read the emulator discovery file',
      'Restart the Virtual Device with ovd vvd stop, then ovd vvd start'
    )
  }
  return {
    consolePort: parsed.data['port.serial'],
    grpcPort: parsed.data['grpc.port'],
    token: parsed.data['grpc.token']
  }
}
