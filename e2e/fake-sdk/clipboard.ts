// The sandbox's `osascript`, `xclip` and `wl-copy` (on PATH before the real ones): each records
// its name, arguments and how many bytes it read on stdin, and exits 0, so e2e exercises the
// CLI's choice of tool without touching the real clipboard.
import { appendFileSync, readFileSync } from 'node:fs'

const [file, tool, ...args] = process.argv.slice(2)
if (!file || !tool) process.exit(99)
// `wl-copy` reads the PNG on stdin; the others get no stdin (it is ignored, which reads as empty).
let stdinBytes = 0
try {
  stdinBytes = readFileSync(0).length
} catch {
  stdinBytes = 0
}
appendFileSync(file, `${JSON.stringify({ tool, args, stdinBytes })}\n`)
