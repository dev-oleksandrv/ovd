import type { Sandbox } from './sandbox.ts'

// Adds a new player crash while the app runs, with no launch (the fake SDK answers from its
// recordings, fixtures/0.24/README.md): the next `loggingctl vault --ls SYSTEM_TOMBSTONE/acr`
// lists it, and on the Virtual Device `vlcm crash-history` shows it too. `vvd` is index 105, pid
// 7746, a JavaScript crash (`loggingctl-vault-ls/virtual-device-js-after.json`, whose listing
// before the crash, `virtual-device-js-before.json`, holds 19 older reports of the player, each
// with a recorded bounded read); injected after a launch that crashed, it is index 106
// (`virtual-device-js-after-second.json`). `stick` is index 2085 (its recorded vault listing).
export function injectPlayerCrash(
  sandbox: Pick<Sandbox, 'update'>,
  device: 'vvd' | 'stick' = 'vvd'
): void {
  sandbox.update((w) => {
    if (device === 'vvd') w.playerCrashInjected = true
    else w.stickPlayerCrashed = true
  })
}

// Marks a crash's package as uninstalled since: the full-ACR pull of that index then holds the
// -7 error (`loggingctl-vault-acr/insufficient-permissions.json`).
export function markCrashUninstalled(sandbox: Pick<Sandbox, 'update'>, index: number): void {
  sandbox.update((w) => {
    if (!w.uninstalledCrashes.includes(index)) w.uninstalledCrashes.push(index)
  })
}
