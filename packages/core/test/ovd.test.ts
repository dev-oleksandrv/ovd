import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { createOvd } from '../src/index.js'
import { FakeRunner } from './support/fakeRunner.js'
import { fixture } from './support/fixtures.js'

test('createOvd wires devices to the runner, OVD_HOME and the surface', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ovd-home-'))
  const runner = new FakeRunner({
    'vega exec vda devices -l': { stdout: fixture('0.24/vda-devices/stick-usb.txt') },
    'vega virtual-device status': {
      stdout: fixture('0.24/vega-virtual-device-status/stopped.json')
    },
    'vega device info --device G070000000000001': {
      stdout: fixture('0.24/vega-device-info/stick-usb.json')
    }
  })
  const ovd = createOvd({
    surface: 'desktop',
    env: { OVD_HOME: home },
    homedir: '/nowhere',
    runner,
    discover: async () => ({ vegaPath: '/sdk/vega', cli: 'manager', sdkVersion: '0.24.12112' })
  })
  expect((await ovd.devices.list()).target).toBe('G070000000000001')
  await ovd.devices.setTarget('G070000000000001')
  expect(await readFile(join(home, 'activity.jsonl'), 'utf8')).toContain('"surface":"desktop"')
  expect(runner.calls[0]?.file).toBe('/sdk/vega')
  expect(await ovd.sdk.get()).toMatchObject({ sdkVersion: '0.24.12112' })
})
