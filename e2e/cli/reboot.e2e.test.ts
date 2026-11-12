import { describe, expect, test } from 'vitest'
import { STICK_SERIAL, usbStick, VVD_VDA_SERIAL } from '../fake-sdk/world.ts'
import { ovd, startOvd } from '../harness/cli.ts'
import { createSandbox } from '../harness/vitest.ts'

interface Rebooted {
  ok: true
  reboot: { target: { id: string; name: string }; seconds: number; reconnected: boolean }
}

const rebootEntries = (sandbox: ReturnType<typeof createSandbox>) =>
  sandbox.activity().filter((a) => a.action === 'reboot')

describe('ovd reboot', () => {
  test('the Virtual Device goes offline and comes back online', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['reboot', '--device', 'VirtualDevice', '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json<Rebooted>().reboot).toMatchObject({
      target: { id: 'VirtualDevice', name: 'Vega Virtual Device' },
      reconnected: false
    })
    expect(run.stderr).toContain('Rebooting Vega Virtual Device…')
    const calls = sandbox.calls()
    expect(calls.filter((c) => c === `vega exec vda -s ${VVD_VDA_SERIAL} reboot`)).toHaveLength(1)
    // It was seen away (the fake lists it offline for `rebootMs`) before it counted as back.
    expect(sandbox.world().vvd.rebootingUntil).toBeLessThan(Date.now())
    expect(rebootEntries(sandbox)).toEqual([
      expect.objectContaining({
        surface: 'cli',
        target: 'VirtualDevice',
        args: { timeout: '120' },
        result: 'ok'
      })
    ])
    // Back online: an action on it works again.
    const devices = await ovd(sandbox, ['devices', '--json'])
    expect(devices.json<{ devices: { id: string; status: string }[] }>().devices).toContainEqual(
      expect.objectContaining({ id: 'VirtualDevice', status: 'online' })
    )
  })

  test('a stick on USB leaves the list and comes back', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['reboot', '--json'])

    expect(run.exitCode).toBe(0)
    expect(run.json<Rebooted>().reboot.target.id).toBe(STICK_SERIAL)
    expect(sandbox.calls()).toContain(`vega exec vda -s ${STICK_SERIAL} reboot`)
    expect(rebootEntries(sandbox)).toEqual([
      expect.objectContaining({ target: STICK_SERIAL, result: 'ok' })
    ])
  })

  test('a stopped Virtual Device is refused, exit 4, nothing sent', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk()

    const run = await ovd(sandbox, ['reboot', '--device', 'VirtualDevice', '--json'])

    expect(run.exitCode).toBe(4)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'TARGET_OFFLINE' } })
    expect(sandbox.calls().filter((c) => c.endsWith(' reboot'))).toEqual([])
    expect(rebootEntries(sandbox)).toEqual([
      expect.objectContaining({ target: null, result: 'error', errorCode: 'TARGET_OFFLINE' })
    ])
  })

  test('--timeout below 30 s is a usage error before any SDK call', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['reboot', '--timeout', '5', '--json'])

    expect(run.exitCode).toBe(2)
    expect(run.json()).toMatchObject({ ok: false, error: { code: 'INVALID_TIMEOUT' } })
    expect(sandbox.calls()).toEqual([])
  })

  test('ovd logs on the Virtual Device reconnects across the reboot and keeps streaming', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: true } })
    sandbox.installSdk()
    type Line = { ovd?: { kind: string }; level?: string }
    const linesOf = (out: string): Line[] =>
      out
        .split('\n')
        .slice(0, -1)
        .filter((l) => l.startsWith('{'))
        .map((l) => JSON.parse(l) as Line)
    const kinds = (lines: Line[]) => lines.flatMap((l) => (l.ovd ? [l.ovd.kind] : []))

    const logs = startOvd(sandbox, ['logs', '--device', 'VirtualDevice', '--json'], {
      timeoutMs: 50_000
    })
    await logs.waitForStdout((out) => linesOf(out).some((l) => l.level))

    const run = await ovd(sandbox, ['reboot', '--device', 'VirtualDevice', '--json'])
    expect(run.exitCode).toBe(0)

    const out = await logs.waitForStdout((o) => {
      const lines = linesOf(o)
      const at = lines.findIndex((l) => l.ovd?.kind === 'reconnected')
      return at >= 0 && lines.slice(at + 1).some((l) => l.level)
    }, 30_000)
    logs.signal('SIGINT')
    const stopped = await logs.done
    expect(stopped.exitCode).toBe(0)
    const lines = linesOf(out)
    expect(kinds(lines).slice(0, 2)).toEqual(['disconnected', 'reconnected'])
    // Two streams: the one the reboot ended (exit 0) and the one after it.
    expect(sandbox.world().vvdLogStreams).toBeGreaterThanOrEqual(2)
  })
})
