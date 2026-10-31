import type { Device, ErrorJson, LoginPrompt } from '@ovd/core'
import { useEffect, useRef, useState } from 'react'
import { useFeedback } from '../feedback/feedbackContext'
import { RouteOption } from '../pairing/RouteOption'
import { Button } from '../ui/Button'
import { CommandLine } from '../ui/CommandLine'
import { InlineError } from '../ui/InlineError'
import { StepList } from '../ui/StepList'
import { Wizard } from '../ui/Wizard'
import { AddressField } from '../pairing/AddressField'
import { CodeField } from './CodeField'
import { LoginPromptCard } from './LoginPromptCard'
import { ProgressLine } from './ProgressLine'
import { CODE_LENGTH, ctaLabel, doneText, enableCommand, errorView, setupCli } from './setupView'

interface SetupWizardProps {
  onClose: () => void
  // Step 4's Wi‑Fi route: the pairing wizard takes over.
  onPair: () => void
  // Done on the last step: the caller shows Devices.
  onDone: (device: Device) => void
}

type Busy = 'probe' | 'login' | 'enable' | 'usb' | null

// Set up a new stick, Step N of 4 (Stage 1.5), copy from the design's SETUP WIZARD.
// The vendor field appears only once the SDK asks for a vendor: OVD can't list vendors.
export function SetupWizard({ onClose, onPair, onDone }: SetupWizardProps) {
  const { notify, echo } = useFeedback()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState<Busy>(null)
  const [signedIn, setSignedIn] = useState(false)
  const [prompt, setPrompt] = useState<LoginPrompt | null>(null)
  const [code, setCode] = useState('')
  const [vendor, setVendor] = useState('')
  const [askVendor, setAskVendor] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [device, setDevice] = useState<Device | null>(null)
  const [error, setError] = useState<ErrorJson | null>(null)
  // State updates land after a render; a ref stops a second click in the same tick.
  const running = useRef(false)
  // Results of a sign-in or wait that arrive after the wizard closed are dropped.
  const open = useRef(true)

  useEffect(() => {
    echo(setupCli())
    open.current = true
    const unsubscribe = window.ovd.setup.onLoginPrompt(setPrompt)
    return () => {
      open.current = false
      unsubscribe()
    }
    // Once per wizard: `echo` changes identity with every toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function run<T>(
    kind: Exclude<Busy, null>,
    action: () => Promise<{ ok: true; data: T } | { ok: false; error: ErrorJson }>,
    onOk: (data: T) => void
  ): Promise<void> {
    if (running.current) return
    running.current = true
    setBusy(kind)
    setError(null)
    const result = await action()
    running.current = false
    if (!open.current) return
    setBusy(null)
    if (result.ok) onOk(result.data)
    else {
      if (result.error.code === 'VENDOR_REQUIRED') setAskVendor(true)
      setError(result.error)
    }
  }

  const probe = (): Promise<void> =>
    run(
      'probe',
      () => window.ovd.setup.signedIn(),
      (yes) => setSignedIn(yes)
    )

  const login = (): Promise<void> => {
    echo(setupCli())
    return run(
      'login',
      () => window.ovd.setup.login(),
      () => {
        setSignedIn(true)
        setPrompt(null)
      }
    )
  }

  const enable = (): Promise<void> => {
    echo(setupCli(code, vendor))
    return run(
      'enable',
      () => window.ovd.setup.enable(code, vendor || undefined),
      () => setEnabled(true)
    )
  }

  const waitUsb = (): Promise<void> => {
    echo(setupCli(code, vendor))
    return run('usb', () => window.ovd.setup.waitForStick(), setDevice)
  }

  function close(): void {
    // A sign-in or wait in main would otherwise run on behind a closed wizard.
    if (busy === 'login' || busy === 'usb') void window.ovd.setup.cancel()
    onClose()
  }

  function retry(): void {
    if (!error) return
    const view = errorView(error)
    setError(null)
    if (view.retry === 'code') setCode('')
    else if (view.retry === 'login') {
      setStep(1)
      setSignedIn(false)
      void login()
    } else if (step === 1) void (signedIn ? probe() : login())
    else if (step === 2) void enable()
    else if (step === 3) void waitUsb()
  }

  const codeReady = code.length === CODE_LENGTH && (!askVendor || vendor.trim() !== '')
  const ready =
    busy === null &&
    error === null &&
    !(step === 2 && !enabled && !codeReady) &&
    !(step === 3 && !device)

  function next(): void {
    if (!ready) return
    if (step === 0) {
      setStep(1)
      void probe()
    } else if (step === 1) {
      if (signedIn) setStep(2)
      else void login()
    } else if (step === 2) {
      if (enabled) setStep(3)
      else void enable()
    } else if (device) {
      notify({ tone: 'ok', text: `${device.name} is ready`, cli: setupCli(code, vendor) })
      onDone(device)
    }
  }

  async function copyCode(userCode: string): Promise<void> {
    await navigator.clipboard.writeText(userCode)
    notify({ tone: 'ok', text: `Copied code ${userCode}` })
  }

  function openBrowser(uri: string): void {
    // Main opens new windows in the default browser (setWindowOpenHandler).
    window.open(uri, '_blank')
    notify({ tone: 'info', text: 'Opened your browser', cli: uri })
  }

  const shownError = error && errorView(error)

  return (
    <Wizard
      title="Set up a new stick"
      subtitle="Turn on Developer Mode so the stick shows up in OVD"
      step={step + 1}
      totalSteps={4}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy !== null}
            disabled={busy === null && !ready}
            disabledReason={
              step === 2 ? 'Enter the 6-character code from the TV' : 'Waiting for the stick'
            }
            onClick={next}
          >
            {ctaLabel(step, { busy: busy !== null, signedIn, enabled, done: device !== null })}
          </Button>
        </>
      }
    >
      {step === 0 && (
        <>
          <div className="text-title font-semibold">On the TV</div>
          <StepList
            steps={[
              'Open Settings → My Fire TV → About.',
              'Select the device name 7 times, until the TV says “You are now a developer”.',
              'Press Back, then Developer options → Developer Mode → Continue.',
              'The TV shows a code. Leave it on screen.'
            ]}
          />
        </>
      )}

      {step === 1 && (
        <>
          <div className="text-title font-semibold">Sign in to your Amazon Developer account</div>
          {!signedIn && busy !== 'probe' && (
            <>
              <div className="leading-normal text-text-soft">
                OVD runs the command below. Open the link in your browser and enter the code to sign
                in.
              </div>
              <CommandLine command="vega devmode login" />
            </>
          )}
          {busy === 'login' && prompt && (
            <>
              <LoginPromptCard
                prompt={prompt}
                onCopy={() => void copyCode(prompt.userCode)}
                onOpen={() => openBrowser(prompt.verificationUri)}
              />
              <ProgressLine text="Waiting for sign-in in your browser…" />
            </>
          )}
          {signedIn && <ProgressLine done text="Signed in to Amazon Developer Services" />}
        </>
      )}

      {step === 2 && (
        <>
          <div className="text-title font-semibold">Enter the code from the TV</div>
          <CodeField value={code} onChange={setCode} onEnter={next} />
          {askVendor && (
            <div className="max-w-[360px]">
              <AddressField label="Vendor ID" value={vendor} onChange={setVendor} onEnter={next} />
            </div>
          )}
          <CommandLine command={enableCommand(code, vendor.trim())} />
          {busy === 'enable' && <ProgressLine text="Enabling Developer Mode…" />}
          {enabled && <ProgressLine done text="The device is rebooting" />}
        </>
      )}

      {step === 3 && (
        <>
          <div className="text-title font-semibold">Connect the stick</div>
          <div role="radiogroup" aria-label="Connection" className="grid grid-cols-2 gap-2.5">
            <RouteOption
              icon="usb"
              title="USB"
              body="Plug the stick into this computer."
              selected={busy === 'usb' || device !== null}
              onSelect={() => {
                if (busy === null && device === null) void waitUsb()
              }}
            />
            <RouteOption
              icon="wifi"
              title="Wi-Fi"
              body="Continue in the pairing wizard."
              selected={false}
              onSelect={() => {
                if (busy === null) onPair()
              }}
            />
          </div>
          {busy === 'usb' && <ProgressLine text="Waiting for a new stick to appear in Devices…" />}
          {device && <ProgressLine done text={doneText(device)} />}
        </>
      )}

      {shownError && (
        <>
          <InlineError title={shownError.title} body={shownError.body} />
          <div>
            <Button icon="refresh" onClick={retry}>
              {shownError.cta}
            </Button>
          </div>
        </>
      )}
    </Wizard>
  )
}
