import { createServer, type Server } from 'node:net'
import type { Check, DoctorReport } from '@ovd/core'
import { afterEach, describe, expect, test } from 'vitest'
import { ovd, startOvd } from '../harness/cli.ts'
import { stillRunning } from '../harness/sandbox.ts'
import { createSandbox } from '../harness/vitest.ts'
import { STICK_SERIAL, usbStick } from '../fake-sdk/world.ts'

type Report = DoctorReport & { ok: true }

function byId(report: Report): Record<string, Check> {
  return Object.fromEntries(report.checks.map((c) => [c.id, c]))
}

describe('ovd doctor', () => {
  test('SIGTERM while the sign-in probe waits exits 143 and leaves no probe', async () => {
    const sandbox = createSandbox({
      account: 'signed-out',
      browserSignIn: 'never',
      loginHold: true
    })
    sandbox.installSdk()
    const running = startOvd(sandbox, ['doctor', '--json'])

    // The probe comes after the SDK, VDA and device checks, each a fake `vega` start.
    await expect.poll(() => sandbox.probePids().length, { timeout: 15_000 }).toBeGreaterThan(0)
    running.signal('SIGTERM')

    const run = await running.done
    expect(run.exitCode).toBe(143)
    // A forced stop doesn't wait for the probe's group: poll, with a bound.
    await expect.poll(() => stillRunning(sandbox.probePids()), { timeout: 5_000 }).toEqual([])
    expect(sandbox.world().account).toBe('signed-out')
  })

  test('without an SDK, only the SDK check runs and it links the install', async () => {
    const sandbox = createSandbox()

    const run = await ovd(sandbox, ['doctor', '--json'])

    expect(run.exitCode).toBe(1)
    const checks = byId(run.json<Report>())
    expect(checks.sdk).toMatchObject({ status: 'fail', fix: 'install-sdk' })
    expect(checks.sdk?.hint).toContain(
      'https://developer.amazon.com/docs/vega/0.24/sdk-manager.html'
    )
    for (const id of ['vda', 'devices', 'devmode', 'metro', 'grpc']) {
      expect(checks[id]).toMatchObject({ status: 'skipped', detail: 'Waiting for the Vega SDK' })
    }
    expect(sandbox.calls()).toEqual([])
  })

  test('the SDK-bundled vega alone fails the SDK check and skips the sign-in check', async () => {
    const sandbox = createSandbox()
    sandbox.installSdk('bundled')

    const run = await ovd(sandbox, ['doctor', '--json'])

    expect(run.exitCode).toBe(1)
    const checks = byId(run.json<Report>())
    expect(checks.sdk).toMatchObject({ status: 'fail', fix: 'install-cli' })
    expect(checks.devmode).toMatchObject({
      status: 'skipped',
      detail: 'Needs the Vega CLI (SDK Manager)'
    })
    expect(sandbox.calls()).not.toContain('vega devmode login --json')
  })

  test('with the SDK and no devices, it explains that a stick needs Developer Mode', async () => {
    // A stick without Developer Mode is plugged in, and invisible (ADR 0009).
    const sandbox = createSandbox({
      stick: usbStick({ developerMode: false }),
      account: 'signed-out',
      browserSignIn: 'never'
    })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['doctor'])

    // Warnings only: the report succeeds.
    expect(run.exitCode).toBe(0)
    expect(run.stdout).toMatch(/✓ Vega SDK\s+0\.24\.12112 · Vega CLI 1\.4\.5 · ~\/vega\/bin\/vega/)
    expect(run.stdout).toMatch(/✓ VDA\s+Checked with vega exec vda version/)
    expect(run.stdout).toMatch(/! Devices\s+No devices connected/)
    expect(run.stdout).toContain('→ A Fire TV stick shows up only after Developer Mode is on.')
    expect(run.stdout).toMatch(/! Developer Mode\s+Not signed in — needed to set up a new stick/)
    // Doctor only reads: the sign-in it probed is stopped, not left waiting for the browser.
    expect(sandbox.world().account).toBe('signed-out')
  })

  test('with a signed-in account and a stick on USB, every check passes', async () => {
    const sandbox = createSandbox({ stick: usbStick() })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['doctor', '--json'])

    expect(run.exitCode).toBe(0)
    const checks = byId(run.json<Report>())
    expect(checks.devices).toMatchObject({ status: 'ok', detail: '1 online · 1 unavailable' })
    expect(checks.devmode?.status).toBe('ok')
    // The only online device is the target, so its Metro reverse ports are checked.
    expect(checks.metro?.detail).toContain('not reversed on Fire TV stick')
    expect(sandbox.calls()).toEqual(
      expect.arrayContaining([
        `vega device is-port-forwarded --port 8081 --forward false --device ${STICK_SERIAL}`,
        `vega device is-port-forwarded --port 8097 --forward false --device ${STICK_SERIAL}`
      ])
    )
    // Doctor never writes state or the activity log.
    expect(sandbox.hostState()).toBeNull()
    expect(sandbox.activity()).toEqual([])
  })

  test('VDA not answering fails its check and skips the checks that need it', async () => {
    const sandbox = createSandbox({ vda: 'broken' })
    sandbox.installSdk()

    const run = await ovd(sandbox, ['doctor', '--json'])

    expect(run.exitCode).toBe(1)
    const checks = byId(run.json<Report>())
    expect(checks.vda).toMatchObject({ status: 'fail', command: 'vega exec vda version' })
    expect(checks.devices).toMatchObject({ status: 'skipped', detail: 'Waiting for VDA' })
    expect(checks.metro).toMatchObject({ status: 'skipped', detail: 'Waiting for VDA' })
  })

  test('Developer Mode off on the Virtual Device is reported and fixed in one command', async () => {
    const sandbox = createSandbox({ vvd: { running: true, developerMode: false } })
    sandbox.installSdk()

    const before = byId((await ovd(sandbox, ['doctor', '--json'])).json<Report>())
    expect(before.devmode).toMatchObject({
      status: 'warn',
      detail: 'Developer Mode is off on the Virtual Device',
      fix: 'enable-vvd-devmode',
      command: 'vega exec vda -s emulator-5554 shell vsm developer-mode'
    })

    const enable = await ovd(sandbox, ['vvd', 'devmode', 'enable', '--json'])
    expect(enable.exitCode).toBe(0)
    expect(enable.json()).toEqual({ ok: true, vvd: { developerMode: true } })

    const after = byId((await ovd(sandbox, ['doctor', '--json'])).json<Report>())
    expect(after.devmode?.status).toBe('ok')
  })

  // Issue #30: a terminal that runs the SDK's own `vega` reaches the SDK by a second path, and
  // the SDK rebuilds its workspace every time the path switches, failing builds while OVD runs.
  describe('Shell PATH', () => {
    test('the SDK’s own bin first warns how to fix it, and the fixed PATH passes', async () => {
      const sandbox = createSandbox()
      sandbox.installSdk()
      sandbox.vegaOnPath(['sdk-bin', 'cli'])

      const run = await ovd(sandbox, ['doctor'])

      // A warning only: the report succeeds, and OVD itself still runs the Vega CLI.
      expect(run.exitCode).toBe(0)
      expect(run.stdout).toMatch(
        /✓ Vega SDK\s+0\.24\.12112 · Vega CLI 1\.4\.5 · ~\/vega\/bin\/vega/
      )
      expect(run.stdout).toMatch(
        /! Shell PATH\s+~\/vega\/sdk\/0\.24\.12112\/bin comes before ~\/vega\/bin — builds fail while OVD runs/
      )
      expect(run.stdout).toContain(
        '→ Put ~/vega/bin before ~/vega/sdk/0.24.12112/bin on your PATH, or remove ~/vega/sdk/0.24.12112/bin, then open a new terminal'
      )

      // The user puts ~/vega/bin first, as the hint says.
      sandbox.vegaOnPath(['cli', 'sdk-bin'])
      const fixed = await ovd(sandbox, ['doctor', '--json'])

      expect(fixed.exitCode).toBe(0)
      expect(byId(fixed.json<Report>()).path).toEqual({
        id: 'path',
        name: 'Shell PATH',
        status: 'ok',
        detail: 'vega is ~/vega/bin/vega',
        command: 'command -v vega'
      })
    })

    test('no vega on the shell’s PATH is info, with where the Vega CLI is', async () => {
      const sandbox = createSandbox()
      sandbox.installSdk()

      const checks = byId((await ovd(sandbox, ['doctor', '--json'])).json<Report>())

      expect(checks.path).toMatchObject({
        status: 'info',
        detail: 'vega isn’t on your shell’s PATH',
        hint: 'Add ~/vega/bin to your PATH to run vega in a terminal'
      })
    })
  })

  describe('Metro ports', () => {
    let server: Server | undefined
    afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())))

    test('a port in use on this computer is reported', async () => {
      const sandbox = createSandbox()
      sandbox.installSdk()
      server = createServer()
      await new Promise<void>((done) => {
        // Already in use by something else on this machine: the check must say so all the same.
        server?.once('error', () => done())
        server?.listen(8097, '127.0.0.1', done)
      })

      const checks = byId((await ovd(sandbox, ['doctor', '--json'])).json<Report>())

      expect(checks.metro?.status).toBe('info')
      expect(checks.metro?.detail).toMatch(
        /^(8081, )?8097 in use on this computer · no target device$/
      )
    })
  })
})
