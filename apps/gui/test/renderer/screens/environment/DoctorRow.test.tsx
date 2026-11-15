import type { Check } from '@ovd/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { DoctorRow } from '../../../../src/renderer/src/screens/environment/DoctorRow'

const on: Check = { id: 'grpc', name: 'Emulator gRPC', status: 'ok', detail: 'On · :8554' }
const notRunning: Check = {
  id: 'grpc',
  name: 'Emulator gRPC',
  status: 'info',
  detail: 'Not running',
  hint: 'Start it with ovd vvd start'
}
const off: Check = {
  id: 'grpc',
  name: 'Emulator gRPC',
  status: 'warn',
  detail: 'Couldn’t enable',
  hint: 'Turn it on with ovd vvd start',
  fix: 'enable-vvd-grpc'
}

function row(check: Check, opts: { checking?: boolean; busy?: boolean } = {}) {
  const onEnable = vi.fn()
  render(
    <ul>
      <DoctorRow
        check={check}
        checking={opts.checking ?? false}
        enableVvdGrpc={{ busy: opts.busy ?? false, onEnable }}
      />
    </ul>
  )
  return onEnable
}

describe('DoctorRow: Emulator gRPC', () => {
  test('checking', () => {
    row(off, { checking: true })
    expect(screen.getByText('Emulator gRPC')).toBeTruthy()
    expect(screen.getByText('Checking…')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test.each([on, notRunning])('$detail: no button', (check) => {
    row(check)
    expect(screen.getByText(check.detail)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('Couldn’t enable: Turn on runs the fix', () => {
    const onEnable = row(off)
    expect(screen.getByText('Couldn’t enable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(onEnable).toHaveBeenCalledTimes(1)
  })

  test('while it turns on: Turning on…', () => {
    row(off, { busy: true })
    expect(screen.getByRole('button', { name: /Turning on…/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull()
  })
})

// Issue #30: the row names the folder that shadows the Vega CLI and the command it ran.
describe('DoctorRow: Shell PATH', () => {
  const shadowed: Check = {
    id: 'path',
    name: 'Shell PATH',
    status: 'warn',
    detail: '~/vega/sdk/0.24.12112/bin comes before ~/vega/bin — builds fail while OVD runs',
    command: 'command -v vega',
    hint: 'Put ~/vega/bin before ~/vega/sdk/0.24.12112/bin on your PATH, or remove ~/vega/sdk/0.24.12112/bin, then open a new terminal'
  }
  const ok: Check = { ...shadowed, status: 'ok', detail: 'vega is ~/vega/bin/vega' }

  test('checking', () => {
    row(shadowed, { checking: true })
    expect(screen.getByText('Shell PATH')).toBeTruthy()
    expect(screen.getByText('Checking…')).toBeTruthy()
  })

  test.each([ok, shadowed])('$status: the detail and the command, no button', (check) => {
    row(check)
    expect(screen.getByText(check.detail)).toBeTruthy()
    expect(screen.getByText('command -v vega')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
