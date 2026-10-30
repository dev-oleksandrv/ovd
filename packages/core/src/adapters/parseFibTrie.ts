import { unexpectedOutput } from './unexpectedOutput.js'

// `cat /proc/net/fib_trie` on the stick: an address line `|-- <ip>` followed by
// `/32 host LOCAL` is one of the stick's own addresses (fixtures/0.24/vda-shell-fib-trie).
// The stick has no `ip` or `ifconfig`, so this is the only way to read its IP.
export function parseFibTrie(stdout: string): string[] {
  if (!/^Main:/m.test(stdout)) throw unexpectedOutput('the stick’s network addresses', stdout)
  const addresses = new Set<string>()
  let last: string | undefined
  for (const line of stdout.split('\n')) {
    const address = /\|--\s+(\d+\.\d+\.\d+\.\d+)\s*$/.exec(line)?.[1]
    if (address) last = address
    else if (/\/32 host LOCAL/.test(line) && last && !last.startsWith('127.')) addresses.add(last)
  }
  return [...addresses]
}
