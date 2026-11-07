import { OvdError } from '../errors/ovdError.js'

// A package or component ID that passed `assertAppId`. Every SDK command that takes an app ID
// takes this type, so an unchecked string can't reach one.
export type AppId = string & { readonly __appId: true }

// Where an ID came from, for the error message. `folder` and `file` as the user sees them.
export type AppIdSource =
  | { from: 'argument' }
  | { from: 'manifest'; folder: string }
  | { from: 'vpkg'; file: string }
  | { from: 'device'; device: string }

// Vega package and component IDs: `com.example.player`, `com.example.player.main`. Nothing a
// shell expands: `vega exec vda shell` re-wraps its command in a host `sh -c "…"`
// (ARCHITECTURE §8), so `$`, `;`, quotes or spaces in an ID would run on the host.
const APP_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const APP_ID_HINT =
  'An app ID is letters, digits, dots, hyphens and underscores, like com.example.player'

export function isAppId(id: string): id is AppId {
  return APP_ID.test(id)
}

// Throws INVALID_APP_ID, before any SDK call, for anything that isn't an app ID.
export function assertAppId(id: string, source: AppIdSource): AppId {
  if (isAppId(id)) return id
  throw new OvdError('INVALID_APP_ID', invalidMessage(JSON.stringify(id), source), APP_ID_HINT)
}

function invalidMessage(quoted: string, source: AppIdSource): string {
  switch (source.from) {
    case 'argument':
      return `${quoted} isn’t an app ID`
    case 'manifest':
      return `The package ID in ${source.folder}/manifest.toml isn’t an app ID: ${quoted}`
    case 'vpkg':
      return `The package ID in ${source.file} isn’t an app ID: ${quoted}`
    case 'device':
      return `${source.device} reported an ID that isn’t an app ID: ${quoted}`
  }
}
