import type { SdkInfo } from './discoverSdk.js'

export interface SdkLocator {
  get(): Promise<SdkInfo>
  // Doctor's Re-check: forget the cached result and look again.
  rediscover(): Promise<SdkInfo>
}

// Discovery runs `vega --version` per candidate, so a process does it once. A failure isn't
// cached: the user may install the SDK while the desktop app is open.
export function createSdkLocator(discover: () => Promise<SdkInfo>): SdkLocator {
  let cached: Promise<SdkInfo> | undefined

  function start(): Promise<SdkInfo> {
    const attempt = discover()
    cached = attempt
    attempt.catch(() => {
      if (cached === attempt) cached = undefined
    })
    return attempt
  }

  return {
    get: () => cached ?? start(),
    rediscover: start
  }
}
