import type { Device, ErrorJson } from '@ovd/core'
import { useRef, useState } from 'react'
import { useFeedback } from '../feedback/feedbackContext'
import { Button } from '../ui/Button'
import { CommandLine } from '../ui/CommandLine'
import { Icon } from '../ui/Icon'
import { InlineError } from '../ui/InlineError'
import { StepList } from '../ui/StepList'
import { Wizard } from '../ui/Wizard'
import { AddressField } from './AddressField'
import { PairedCard } from './PairedCard'
import {
  addressOf,
  ctaLabel,
  DEFAULT_PORT,
  errorView,
  pairCli,
  portOk,
  type PairRoute
} from './pairView'
import { RouteOption } from './RouteOption'

interface PairWizardProps {
  onClose: () => void
  // The wizard's last step closed with Done: the caller shows Devices.
  onDone: (device: Device) => void
}

// Pair a device over Wi‑Fi, Step N of 4 (Stage 1.6), copy from the design's PAIR WIZARD.
// The USB route runs `ovd pair --usb`, which reads the stick's IP itself, so it goes from the
// instructions straight to Paired; only the TV route asks for the address.
export function PairWizard({ onClose, onDone }: PairWizardProps) {
  const { notify, echo } = useFeedback()
  const [step, setStep] = useState(0)
  const [route, setRoute] = useState<PairRoute>('usb')
  const [ip, setIp] = useState('')
  const [port, setPort] = useState(DEFAULT_PORT)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorJson | null>(null)
  const [paired, setPaired] = useState<Device | null>(null)
  // State updates land after a render; a ref stops a second click in the same tick.
  const running = useRef(false)

  const cli = pairCli(route, ip, port)
  const addressReady = ip.trim() !== '' && portOk(port)
  const enabled = !busy && (step !== 2 || addressReady)

  async function pair(): Promise<void> {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError(null)
    echo(cli)
    const result =
      route === 'usb'
        ? await window.ovd.pairing.pairUsb()
        : await window.ovd.pairing.pair(addressOf(ip, port))
    running.current = false
    setBusy(false)
    if (result.ok) {
      setPaired(result.data)
      setStep(3)
    } else {
      setError(result.error)
    }
  }

  function next(): void {
    if (!enabled) return
    if (step === 0) setStep(1)
    else if (step === 1 && route === 'tv') setStep(2)
    else if (step === 1 || step === 2) void pair()
    else if (paired) {
      notify({ tone: 'ok', text: 'Device paired over Wi-Fi', cli })
      onDone(paired)
    }
  }

  const shownError = error && errorView(error, route === 'usb' ? DEFAULT_PORT : port)

  return (
    <Wizard
      title="Pair a device over Wi-Fi"
      step={step + 1}
      totalSteps={4}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!busy && !enabled}
            disabledReason="Enter the IP address and a port above 1024"
            onClick={next}
          >
            {ctaLabel(step, route, error !== null)}
          </Button>
        </>
      }
    >
      {step === 0 && (
        <>
          <div className="text-lead font-semibold">How do you want to connect?</div>
          <div role="radiogroup" aria-label="Route" className="grid grid-cols-2 gap-2.5">
            <RouteOption
              icon="usb"
              title="With USB"
              body="Plug in once — OVD switches the stick to TCP/IP, then you unplug."
              selected={route === 'usb'}
              onSelect={() => setRoute('usb')}
            />
            <RouteOption
              icon="settings_remote"
              title="Without USB"
              body="Turn on TCP/IP in the TV’s Developer Options."
              selected={route === 'tv'}
              onSelect={() => setRoute('tv')}
            />
          </div>
          <div className="text-small text-muted">Both routes need Developer Mode on the stick.</div>
        </>
      )}

      {step === 1 && route === 'usb' && (
        <>
          <div className="text-lead font-semibold">Switch the stick to TCP/IP</div>
          <StepList
            steps={[
              'Plug the stick into this computer over USB.',
              'OVD runs the command below to put VDA in network mode on port 5555.',
              'Unplug USB — the stick keeps listening on port 5555.'
            ]}
          />
          <CommandLine command="vega exec vda tcpip 5555" />
        </>
      )}

      {step === 1 && route === 'tv' && (
        <>
          <div className="text-lead font-semibold">Turn on TCP/IP on the TV</div>
          <StepList
            steps={[
              'Settings → My Fire TV → About → Developer Options.',
              'Connection Mode → TCP/IP.',
              'Choose a port above 1024 (5555 is the default).',
              'Wait for the TV to reboot to the home screen.'
            ]}
          />
          <div className="flex items-center gap-2 text-small text-muted">
            <Icon name="info" size={16} />
            Connection Mode only appears on the latest OS, with Developer Mode on.
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="text-lead font-semibold">Connect by IP address</div>
          <div className="text-muted">
            Find the IP on the TV in Settings → My Fire TV → About → Network.
          </div>
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <AddressField label="IP address" value={ip} onChange={setIp} onEnter={next} autoFocus />
            <AddressField
              label="Port"
              value={port}
              onChange={(value) => setPort(value.trim())}
              onEnter={next}
              invalid={!portOk(port)}
            />
          </div>
          {!portOk(port) && (
            <div className="text-small text-error-soft">Port must be a number above 1024.</div>
          )}
        </>
      )}

      {shownError && step !== 3 && <InlineError title={shownError.title} body={shownError.body} />}
      {step === 2 && <CommandLine command={`vega exec vda connect ${addressOf(ip, port)}`} />}

      {step === 3 && paired && (
        <>
          <div className="text-lead font-semibold">Paired</div>
          <CommandLine command={`vega exec vda connect ${paired.id}`} result="connected" />
          <div className="text-label tracking-[.06em] text-subtle uppercase">Now in Devices</div>
          <PairedCard device={paired} />
        </>
      )}
    </Wizard>
  )
}
