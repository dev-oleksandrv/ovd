import { unexpectedOutput } from './unexpectedOutput.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// `cat /proc/sys/kernel/random/boot_id` prints the boot ID as one dashed UUID (ARCHITECTURE §8).
// It is kept without dashes, in lower case: the form `loggingctl log -b` takes, and the form
// OVD compares.
export function parseBootId(stdout: string): string {
  const text = stdout.trim()
  if (!UUID.test(text)) throw unexpectedOutput('the device’s boot ID', stdout)
  return text.replaceAll('-', '').toLowerCase()
}
