import type { Check, Device } from '@ovd/core'
import { useState } from 'react'
import { useFeedback } from '../feedback/feedbackContext'
import { CommandPalette } from '../frame/CommandPalette'
import { NavGroup } from '../frame/NavGroup'
import { NavItem } from '../frame/NavItem'
import { SearchButton } from '../frame/SearchButton'
import { TargetPicker } from '../frame/TargetPicker'
import { DoctorRow } from '../screens/environment/DoctorRow'
import { paletteItems } from '../shell/paletteItems'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Chip } from '../ui/Chip'
import { CodeBlock } from '../ui/CodeBlock'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { KeyValueGrid } from '../ui/KeyValueGrid'
import { LoadingState } from '../ui/LoadingState'
import { Modal } from '../ui/Modal'
import { OfflineState } from '../ui/OfflineState'
import { StatusDot } from '../ui/StatusDot'
import { StatusPill } from '../ui/StatusPill'
import { Table, type Column } from '../ui/Table'
import { Tabs } from '../ui/Tabs'
import { TextField } from '../ui/TextField'
import { Wizard } from '../ui/Wizard'
import { GallerySection } from './GallerySection'

// Dev-only page with every base component in every state (Stage 0.2). Sample data uses the
// neutral set (ADR 0016).

const DOCTOR_ROWS: Check[] = [
  {
    id: 'sdk',
    name: 'Vega SDK',
    status: 'ok',
    detail: '0.24.12112 · Vega CLI 1.4.5 · ~/vega/bin/vega',
    command: 'vega sdk config doctor --json'
  },
  {
    id: 'metro',
    name: 'Metro',
    status: 'info',
    detail: '8081 in use on this computer · not reversed on Fire TV Stick 4K Select',
    command: 'vega device is-port-forwarded'
  },
  {
    id: 'devices',
    name: 'Devices',
    status: 'warn',
    detail: 'No devices connected',
    command: 'vega exec vda devices -l'
  },
  {
    id: 'vda',
    name: 'VDA',
    status: 'fail',
    detail: 'vega exec vda version didn’t respond',
    command: 'vega exec vda version'
  },
  { id: 'devmode', name: 'Developer Mode', status: 'skipped', detail: 'Waiting for the Vega SDK' }
]

interface SampleApp {
  id: string
  title: string
  version: string
  status: 'running' | 'stopped' | 'crashed'
}

const apps: SampleApp[] = [
  { id: 'com.example.player', title: 'Sample Player', version: '1.4.2', status: 'running' },
  {
    id: 'com.example.player.debug',
    title: 'Sample Player Debug',
    version: '1.4.3-dev',
    status: 'crashed'
  },
  { id: 'com.example.hellovega', title: 'Hello Vega', version: '1.0.0', status: 'stopped' }
]

const columns: Array<Column<SampleApp>> = [
  {
    key: 'app',
    header: 'App',
    width: 'minmax(0,2.2fr)',
    render: (a) => (
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="font-semibold">{a.title}</div>
        <div className="truncate font-mono text-label text-muted">{a.id}</div>
      </div>
    )
  },
  {
    key: 'version',
    header: 'Version',
    width: '90px',
    render: (a) => <span className="font-mono text-small text-text-soft">{a.version}</span>
  },
  {
    key: 'status',
    header: 'Status',
    width: '160px',
    render: (a) =>
      a.status === 'running' ? (
        <StatusPill tone="ok">Running · 4182</StatusPill>
      ) : a.status === 'crashed' ? (
        <StatusPill tone="error">Crashed on launch</StatusPill>
      ) : (
        <StatusPill tone="muted">Stopped</StatusPill>
      )
  },
  {
    key: 'quick',
    header: 'Quick',
    width: '96px',
    align: 'right',
    render: (a) => (
      <Button size="sm" icon={a.status === 'running' ? 'stop' : 'play_arrow'}>
        {a.status === 'running' ? 'Stop' : 'Launch'}
      </Button>
    )
  }
]

const info = {
  os: 'OS 2.0',
  build: 'TV Ship/515',
  architecture: 'armv7',
  profile: 'tv',
  product: 'sample',
  simulated: false,
  developerMode: true,
  raw: {}
}

const devices: Device[] = [
  {
    id: 'G4N0AB1234567',
    vdaSerial: 'G4N0AB1234567',
    serial: 'G4N0AB1234567',
    name: 'Fire TV Stick 4K Select',
    kind: 'stick',
    connection: 'usb',
    status: 'online',
    isTarget: true,
    saved: false,
    info
  },
  {
    id: '192.0.2.42:5555',
    vdaSerial: '192.0.2.42:5555',
    serial: 'G4N0AB7654321',
    name: 'Living room stick',
    kind: 'stick',
    connection: 'wifi',
    ip: '192.0.2.42',
    status: 'online',
    isTarget: false,
    saved: true,
    info
  },
  {
    id: 'VirtualDevice',
    serial: 'VirtualDevice',
    name: 'Vega Virtual Device',
    kind: 'vvd',
    connection: 'local',
    status: 'stopped',
    isTarget: false,
    saved: false
  }
]

const deviceInfo = JSON.stringify(
  { name: 'Fire TV Stick 4K Select', os: 'Vega OS 1.1', arch: 'armv7', profile: 'user' },
  null,
  2
)

export function Gallery() {
  const { notify, echo } = useFeedback()
  const [tab, setTab] = useState<'installed' | 'running'>('installed')
  const [selected, setSelected] = useState(apps[0].id)
  const [modal, setModal] = useState(false)
  const [step, setStep] = useState<number | null>(null)
  const [nav, setNav] = useState('devices')
  const [name, setName] = useState('Living room stick')
  const [target, setTarget] = useState(devices[0])
  const [picker, setPicker] = useState(false)
  const [palette, setPalette] = useState(false)

  return (
    <div className="flex flex-1 flex-col gap-8 overflow-auto px-6 py-5">
      <div className="flex flex-col gap-1">
        <div className="text-heading font-semibold tracking-[-0.015em]">Component gallery</div>
        <div className="text-muted">Development builds only · ⌘⇧G / Ctrl+Shift+G toggles it</div>
      </div>

      <GallerySection title="Type">
        <div className="flex flex-col gap-1.5">
          <div className="text-display font-semibold">Display 20 · Fire TV Stick 4K Select</div>
          <div className="text-heading font-semibold">Heading 19 · Devices</div>
          <div className="text-title font-semibold">Title 16 · No devices yet</div>
          <div className="text-lead">Lead 15 · Go to a screen or run an action…</div>
          <div>Body 13 · Discovered over USB, TCP/IP and the local Virtual Device</div>
          <div className="text-small text-muted">Small 12 · SDK pinned 0.24.x</div>
          <div className="font-mono text-label text-muted">Mono 11 · com.example.player</div>
        </div>
      </GallerySection>

      <GallerySection title="Tones and log levels">
        <span className="text-accent">accent</span>
        <span className="text-warning">warning</span>
        <span className="text-error">error</span>
        <span className="text-info">info</span>
        <span className="text-muted">muted</span>
        <span className="font-mono text-log-v">V</span>
        <span className="font-mono text-log-d">D</span>
        <span className="font-mono text-log-i">I</span>
        <span className="font-mono text-log-w">W</span>
        <span className="font-mono text-log-e">E</span>
      </GallerySection>

      <GallerySection title="Icons">
        {['devices', 'apps', 'deployed_code', 'terminal', 'bug_report', 'settings_remote'].map(
          (name) => (
            <Icon key={name} name={name} size={20} className="text-text-soft" />
          )
        )}
        <Icon name="check_circle" fill className="text-accent" />
        <Icon name="progress_activity" spin className="text-accent" />
      </GallerySection>

      <GallerySection title="Buttons">
        <Button variant="primary" icon="play_arrow">
          Use as target
        </Button>
        <Button icon="refresh">Rescan</Button>
        <Button variant="dashed" icon="upload_file">
          Drop .vpkg or browse…
        </Button>
        <Button variant="primary" loading>
          Installing
        </Button>
        <Button disabled disabledReason="Open a project or drop a .vpkg">
          Run
        </Button>
        <Button size="sm" icon="play_arrow">
          Launch
        </Button>
        <IconButton icon="close" label="Close" />
        <IconButton icon="more_horiz" label="More" disabled />
      </GallerySection>

      <GallerySection title="Badges, chips and status">
        <Badge>12</Badge>
        <Badge tone="warning">2</Badge>
        <Badge tone="accent">1 new</Badge>
        <Chip>USB</Chip>
        <Chip mono>armv7</Chip>
        <Chip mono>⌘K</Chip>
        <Chip variant="accent">Target</Chip>
        <span className="flex items-center gap-1.5 text-meta text-accent">
          <StatusDot tone="ok" pulse /> Online
        </span>
        <span className="flex items-center gap-1.5 text-meta text-faint">
          <StatusDot tone="muted" /> Offline
        </span>
        <StatusPill tone="info" pulse>
          Verifying…
        </StatusPill>
        <StatusPill tone="warning">Release build</StatusPill>
      </GallerySection>

      <GallerySection title="Tabs">
        <Tabs
          items={[
            { id: 'installed', label: 'Installed · 3' },
            { id: 'running', label: 'Running · 1', badge: 2, badgeTone: 'error' }
          ]}
          value={tab}
          onChange={setTab}
        />
      </GallerySection>

      <GallerySection title="Table">
        <div className="w-full overflow-hidden rounded-card border border-line">
          <Table
            columns={columns}
            rows={apps}
            rowKey={(a) => a.id}
            selectedKey={selected}
            onSelect={(a) => setSelected(a.id)}
          />
        </div>
      </GallerySection>

      <GallerySection title="Key-value rows, card and code block">
        <div className="w-full">
          <KeyValueGrid
            items={[
              { label: 'OS', value: 'Vega OS 1.1' },
              { label: 'Architecture', value: 'armv7', mono: true },
              { label: 'Profile', value: 'user', mono: true },
              { label: 'Connection', value: 'USB' },
              { label: 'Serial', value: 'G070000000000001', mono: true }
            ]}
          />
        </div>
        <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4">
          <Card title="Running now" action={<a href="#">All apps →</a>}>
            <div className="flex items-center gap-2.5 px-3.5 py-2.5">
              <StatusDot tone="ok" size={6} />
              <span className="flex-1">Sample Player</span>
              <span className="font-mono text-label text-muted">pid 4182 · Foreground</span>
            </div>
          </Card>
          <CodeBlock title="vega device info --json" code={deviceInfo} />
        </div>
      </GallerySection>

      <GallerySection title="Screen states">
        <div className="grid w-full grid-cols-2 gap-3 [&>div]:flex [&>div]:min-h-[220px] [&>div]:rounded-card [&>div]:border [&>div]:border-line-soft">
          <div>
            <LoadingState label="Looking for devices…" />
          </div>
          <div>
            <EmptyState
              title="No devices yet"
              body="Start the Virtual Device, or set up a Fire TV stick with Developer Mode."
              actions={
                <>
                  <Button variant="primary" icon="desktop_windows">
                    Start the Virtual Device
                  </Button>
                  <Button icon="developer_mode_tv">Set up a Fire TV stick</Button>
                </>
              }
            />
          </div>
          <div>
            <ErrorState
              title="No Vega SDK found"
              hint="Install the Vega SDK, then run the check again."
              command="vega --version"
              actions={<Button icon="refresh">Re-check</Button>}
            />
          </div>
          <div>
            <OfflineState
              deviceName="Bedroom stick"
              title="Remote unavailable"
              actions={<Button icon="wifi">Reconnect</Button>}
            />
          </div>
        </div>
      </GallerySection>

      <GallerySection title="Doctor rows">
        <ul className="m-0 flex w-full list-none flex-col overflow-hidden rounded-card border border-line-soft p-0">
          {DOCTOR_ROWS.map((check) => (
            <DoctorRow key={check.id} check={check} />
          ))}
          <DoctorRow check={{ id: 'node', name: 'Node', status: 'ok', detail: '' }} checking />
        </ul>
      </GallerySection>

      <GallerySection title="Toasts and CLI echo">
        <Button
          onClick={() =>
            notify({ tone: 'ok', text: 'Installed Sample Player', cli: 'ovd install player.vpkg' })
          }
        >
          OK toast
        </Button>
        <Button
          onClick={() =>
            notify({
              tone: 'error',
              text: 'Architecture mismatch',
              cli: 'ovd install player-aarch64.vpkg'
            })
          }
        >
          Error toast
        </Button>
        <Button
          onClick={() =>
            notify({
              tone: 'warning',
              text: 'Build folder changed — reinstalled & relaunched',
              action: { label: 'Logs', run: () => undefined }
            })
          }
        >
          Warning toast with action
        </Button>
        <Button onClick={() => notify({ tone: 'info', text: 'Log session restarted' })}>
          Info toast
        </Button>
        <Button onClick={() => echo('ovd devices --json')}>Echo only</Button>
      </GallerySection>

      <GallerySection title="Modal and wizard">
        <Button onClick={() => setModal(true)}>Open modal</Button>
        <Button onClick={() => setStep(1)}>Open wizard</Button>
      </GallerySection>

      <GallerySection title="Title bar controls">
        <div className="flex w-full items-center gap-2.5">
          <TargetPicker
            devices={devices}
            target={target}
            open={picker}
            onOpenChange={setPicker}
            onPick={setTarget}
          />
          <SearchButton platform="darwin" onClick={() => setPalette(true)} />
        </div>
        {palette && (
          <CommandPalette
            items={paletteItems({
              devices,
              target: target?.id ?? null,
              go: () => undefined,
              runDoctor: () => undefined,
              switchTarget: setTarget,
              later: (label) =>
                notify({ tone: 'info', text: `${label} is coming in a later version` })
            })}
            onClose={() => setPalette(false)}
          />
        )}
      </GallerySection>

      <GallerySection title="Sidebar navigation">
        <div className="flex w-[204px] flex-col gap-3.5 rounded-card border border-line bg-chrome px-2.5 py-3">
          <NavGroup label="Device">
            <NavItem
              label="Devices"
              icon="devices"
              active={nav === 'devices'}
              onClick={() => setNav('devices')}
            />
            <NavItem
              label="Apps"
              icon="apps"
              active={nav === 'apps'}
              onClick={() => setNav('apps')}
            />
          </NavGroup>
          <NavGroup label="Debug">
            <NavItem
              label="Logs"
              icon="article"
              badge="12"
              active={nav === 'logs'}
              onClick={() => setNav('logs')}
            />
            <NavItem
              label="Crashes"
              icon="bug_report"
              badge="1 new"
              badgeTone="accent"
              active={nav === 'crashes'}
              onClick={() => setNav('crashes')}
            />
          </NavGroup>
        </div>
      </GallerySection>

      <GallerySection title="Text field">
        <TextField label="Device name" value={name} onChange={setName} />
      </GallerySection>

      {modal && (
        <Modal
          title="Uninstall Sample Player?"
          subtitle="com.example.player on Fire TV Stick 4K Select"
          onClose={() => setModal(false)}
          footer={
            <>
              <Button onClick={() => setModal(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => setModal(false)}>
                Uninstall
              </Button>
            </>
          }
        >
          <div className="px-5 py-4.5 text-muted">This removes the app and its data.</div>
        </Modal>
      )}
      {step !== null && (
        <Wizard
          title="Pair a device over Wi-Fi"
          step={step}
          totalSteps={4}
          onClose={() => setStep(null)}
          footer={
            <>
              <Button disabled={step === 1} onClick={() => setStep(step - 1)}>
                Back
              </Button>
              <Button
                variant="primary"
                onClick={() => (step === 4 ? setStep(null) : setStep(step + 1))}
              >
                {step === 4 ? 'Done' : 'Continue'}
              </Button>
            </>
          }
        >
          <div className="text-title font-semibold">How do you want to connect?</div>
          <div className="text-small text-muted">Both routes need Developer Mode on the stick.</div>
        </Wizard>
      )}
    </div>
  )
}
