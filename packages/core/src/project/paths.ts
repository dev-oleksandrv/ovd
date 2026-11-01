// `~/…` when under the home folder: what surfaces show and put in CLI echoes.
export function tildePath(path: string, homedir: string): string {
  return path === homedir || path.startsWith(`${homedir}/`)
    ? `~${path.slice(homedir.length)}`
    : path
}

export function expandHome(path: string, homedir: string): string {
  return path === '~' || path.startsWith('~/') ? homedir + path.slice(1) : path
}
