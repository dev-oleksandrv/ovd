import type { Check, Device, LaunchCrash, LogEntry } from '@ovd/core'
import { useState } from 'react'
import { useFeedback } from '../feedback/feedbackContext'
import { CommandPalette } from '../frame/CommandPalette'
import { NavGroup } from '../frame/NavGroup'
import { NavItem } from '../frame/NavItem'
import { SearchButton } from '../frame/SearchButton'
import { RunSteps } from '../frame/RunSteps'
import { TargetPicker } from '../frame/TargetPicker'
import { DoctorRow } from '../screens/environment/DoctorRow'
import { ConfirmUninstall } from '../screens/apps/ConfirmUninstall'
import { LaunchCallout } from '../screens/apps/LaunchCallout'
import { LaunchStatus } from '../screens/apps/LaunchStatus'
import { LogRow } from '../screens/logs/LogRow'
import { ScreenPanel } from '../screens/remote/ScreenPanel'
import type { ScreenView } from '../screens/remote/screenPanelView'
import type { RunRow, RunState } from '../run/runView'
import { paletteItems } from '../shell/paletteItems'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Chip } from '../ui/Chip'
import { CodeBlock } from '../ui/CodeBlock'
import { CommandLine } from '../ui/CommandLine'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { KeyValueGrid } from '../ui/KeyValueGrid'
import { LoadingState } from '../ui/LoadingState'
import { MenuButton } from '../ui/MenuButton'
import { BlockedNotice } from '../ui/BlockedNotice'
import { InlineError } from '../ui/InlineError'
import { InlineNote } from '../ui/InlineNote'
import { Modal } from '../ui/Modal'
import { Segmented } from '../ui/Segmented'
import { Select } from '../ui/Select'
import { StepList } from '../ui/StepList'
import { OfflineState } from '../ui/OfflineState'
import { PadButton } from '../ui/PadButton'
import { StatusDot } from '../ui/StatusDot'
import { StatusPill } from '../ui/StatusPill'
import { Table, type Column } from '../ui/Table'
import { Tabs } from '../ui/Tabs'
import { TextField } from '../ui/TextField'
import { ToggleButton } from '../ui/ToggleButton'
import { Wizard } from '../ui/Wizard'
import { GallerySection } from './GallerySection'

// The screen view's states on Remote & Screen (Stage 4.4). The live one shows an empty canvas
// here: frames come only from main.
const SAMPLE_SHOT = {
  target: { id: 'G070000000000001', name: 'Living room stick' },
  backend: 'gwsi-tool-screenshooter' as const,
  path: '/home/developer/ovd/captures/living-room-stick-20261112-140312.png',
  width: 1920,
  height: 1080,
  bytes: 9780,
  takenAt: '2026-11-12T14:03:12.000Z'
}
const SCREEN_VIEWS: { label: string; view: ScreenView }[] = [
  { label: 'Live', view: { kind: 'live' } },
  { label: 'Connecting', view: { kind: 'connecting', name: 'Vega Virtual Device' } },
  {
    label: 'Error',
    view: {
      kind: 'error',
      error: {
        code: 'VVD_GRPC_FAILED',
        message: 'Emulator gRPC rejected OVD’s token',
        hint: 'Turn it on with ovd vvd start'
      }
    }
  },
  {
    label: 'No signal',
    view: { kind: 'no-signal', name: 'Bedroom stick', status: 'offline' }
  },
  { label: 'Stick, empty', view: { kind: 'stick', shot: null, stale: false } },
  { label: 'Stick, latest', view: { kind: 'stick', shot: SAMPLE_SHOT, stale: false } },
  { label: 'Stick, out of date', view: { kind: 'stick', shot: SAMPLE_SHOT, stale: true } }
]

// A run of the sample project on the Virtual Device, in the three states the dropdown shows.
const RUN_ROWS: RunRow[] = [
  {
    id: 'build',
    label: 'Pick build',
    status: 'done',
    detail: 'build/aarch64-debug/player_aarch64.vpkg · debug'
  },
  { id: 'install', label: 'Install', status: 'done', detail: 'on Vega Virtual Device' },
  { id: 'logs', label: 'Start log session', status: 'done' },
  { id: 'launch', label: 'Launch', status: 'done' },
  { id: 'verify', label: 'Verify launch', status: 'active' },
  { id: 'follow', label: 'Following logs', status: 'pending' }
]
const RUN_STATES: { label: string; state: Exclude<RunState, { phase: 'idle' }> }[] = [
  { label: 'Running', state: { phase: 'running', device: 'VirtualDevice', rows: RUN_ROWS } },
  {
    label: 'Done',
    state: {
      phase: 'done',
      device: 'VirtualDevice',
      rows: RUN_ROWS.map((row) => ({ ...row, status: 'done' }))
    }
  },
  {
    label: 'Crashed on launch',
    state: {
      phase: 'failed',
      device: 'VirtualDevice',
      rows: RUN_ROWS.map((row) =>
        row.id === 'verify'
          ? {
              ...row,
              status: 'failed',
              detail: 'Crashed on launch · Error: player: deliberate crash right after launch'
            }
          : row
      )
    }
  }
]

// Dev-only page with every base component in every state (Stage 0.2). Sample data uses the
// neutral set (ADR 0016).

// A crash right after launch, as the Virtual Device's recordings show it (ADR 0016 sample data).
const SAMPLE_CRASH: LaunchCrash = {
  pid: 3200,
  time: '2026-11-08T01:51:44.657Z',
  signal: 'SIGABRT',
  language: 'JavaScript',
  message: 'Error: player: deliberate crash right after launch',
  stack: ['at anonymous (index.bundle:652:20)'],
  logs: [
    'Nov 08 01:51:43.602 lcm_service[1035]: I lcm-server: Received launch request for pkg://com.example.player.main',
    'Nov 08 01:51:43.719 lcm_service[1035]: I lcm-server: appInst[38](com.example.player.main)<F>: Launched in pid 3200',
    "Nov 08 01:51:44.657 acr_core_dump[3242]: Process 'com.example.player' (PID=3200) crashed with signal 6"
  ]
}
const GALLERY_NOW = new Date('2026-11-08T09:00:00.000Z')

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
  { id: 'devmode', name: 'Developer Mode', status: 'skipped', detail: 'Waiting for the Vega SDK' },
  { id: 'grpc', name: 'Emulator gRPC', status: 'ok', detail: 'On · :8554' }
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

// Log rows as the stick prints them (fixtures/0.24/loggingctl-log/stick-follow.txt).
const LOG_ROWS: LogEntry[] = [
  {
    seq: 0,
    time: '2026-11-08T07:27:00.257Z',
    deviceTime: 'Nov 08 07:27:00.257342',
    level: 'E',
    priority: 'err',
    facility: 'user',
    process: 'com.example.player',
    pid: 27178,
    tid: 2842092448,
    tag: 'com.amazon.keplerscript',
    message: '[KeplerScript-JavaScript] player error tick 1',
    parsed: true
  },
  {
    seq: 1,
    time: '2026-11-08T07:27:01.104Z',
    deviceTime: 'Nov 08 07:27:01.104112',
    level: 'I',
    priority: 'info',
    facility: 'user',
    process: 'com.example.player',
    pid: 27178,
    tid: 2842092448,
    tag: 'com.amazon.keplerscript',
    message: '[KeplerScript-JavaScript] player multi\nline two\nline three',
    parsed: true
  },
  {
    seq: 2,
    time: '2026-11-08T07:27:02.310Z',
    deviceTime: null,
    level: 'I',
    priority: null,
    facility: null,
    process: null,
    pid: null,
    tid: null,
    tag: 'OVD',
    message: 'Installed player_armv7.vpkg from the desktop',
    parsed: true,
    ovd: {
      kind: 'install',
      action: 'app.install',
      surface: 'desktop',
      result: 'ok',
      package: 'player_armv7.vpkg'
    }
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
  const [wideModal, setWideModal] = useState(false)
  const [step, setStep] = useState<number | null>(null)
  const [nav, setNav] = useState('devices')
  const [name, setName] = useState('Living room stick')
  const [target, setTarget] = useState(devices[0])
  const [picker, setPicker] = useState(false)
  const [palette, setPalette] = useState(false)
  const [level, setLevel] = useState<'v' | 'd' | 'i' | 'w' | 'e'>('v')
  const [logPackage, setLogPackage] = useState('all')
  const [regex, setRegex] = useState(false)

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
        <Button variant="blocked">Install on target</Button>
        <Button variant="danger">Uninstall</Button>
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

      <GallerySection title="Launch verification">
        <StatusPill tone="error">Crashed on launch</StatusPill>
        <div className="flex w-full flex-col gap-3">
          <LaunchStatus outcome={{ state: 'verifying' }} now={GALLERY_NOW} />
          <LaunchCallout outcome={{ state: 'crashed', crash: SAMPLE_CRASH }} now={GALLERY_NOW} />
          <LaunchCallout
            outcome={{
              state: 'crashed',
              crash: { pid: 3200, time: SAMPLE_CRASH.time, stack: [], logs: [] }
            }}
            now={GALLERY_NOW}
          />
          <LaunchCallout outcome={{ state: 'not-running' }} now={GALLERY_NOW} />
        </div>
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
          <div className="rounded-card border border-line">
            <OfflineState
              deviceName="Living room stick"
              title="Logs unavailable"
              detail="The last log session ended: the device stayed away for 5 minutes."
              actions={<Button>Switch target</Button>}
            />
          </div>
        </div>
        <div className="w-full">
          <BlockedNotice
            action={{ label: 'Use player-1.4.2-armv7.vpkg', onClick: () => undefined }}
          >
            Architecture mismatch: package is <b className="font-mono">aarch64</b>, Fire TV Stick 4K
            Select is <b className="font-mono">armv7</b>. Install is blocked.
          </BlockedNotice>
        </div>
      </GallerySection>

      <GallerySection title="Screen view">
        <div className="grid w-full grid-cols-2 gap-3">
          {SCREEN_VIEWS.map(({ label, view }) => (
            <div key={label} className="flex flex-col gap-1.5">
              <div className="text-label text-muted">{label}</div>
              <ScreenPanel view={view} onRefresh={() => undefined} onRetry={() => undefined} />
            </div>
          ))}
        </div>
      </GallerySection>

      <GallerySection title="Doctor rows">
        <ul className="m-0 flex w-full list-none flex-col overflow-hidden rounded-card border border-line-soft p-0">
          {DOCTOR_ROWS.map((check) => (
            <DoctorRow key={check.id} check={check} />
          ))}
          <DoctorRow
            check={{
              id: 'grpc',
              name: 'Emulator gRPC',
              status: 'warn',
              detail: 'Couldn’t enable',
              hint: 'Turn it on with ovd vvd start',
              fix: 'enable-vvd-grpc'
            }}
            enableVvdGrpc={{
              busy: false,
              onEnable: () => notify({ tone: 'ok', text: 'Emulator gRPC on', cli: 'ovd vvd start' })
            }}
          />
          <DoctorRow check={{ id: 'node', name: 'Node', status: 'ok', detail: '' }} checking />
        </ul>
      </GallerySection>

      <GallerySection title="Toasts and CLI echo">
        <Button
          onClick={() =>
            notify({
              tone: 'ok',
              text: 'Installed Sample Player',
              cli: 'ovd apps install player.vpkg'
            })
          }
        >
          OK toast
        </Button>
        <Button
          onClick={() =>
            notify({
              tone: 'error',
              text: 'Architecture mismatch',
              cli: 'ovd apps install player-aarch64.vpkg'
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
        <Button onClick={() => setWideModal(true)}>Open large modal</Button>
        <Button onClick={() => setStep(1)}>Open wizard</Button>
      </GallerySection>

      <GallerySection title="Wizard step parts">
        <div className="flex w-full max-w-[500px] flex-col gap-3">
          <StepList
            steps={['Connection Mode → TCP/IP.', 'Choose a port above 1024 (5555 is the default).']}
          />
          <CommandLine command="vega exec vda tcpip 5555" />
          <CommandLine command="vega exec vda connect 192.0.2.42:5555" result="connected" />
          <InlineError
            title="Port 5555 looks blocked"
            body="vda connect timed out. A firewall on this computer or the router may be blocking TCP port 5555; allow it, then retry."
          />
          <InlineNote
            title="Reconnecting to Living room stick…"
            body="The device dropped. Lines continue here once it’s back."
          />
        </div>
      </GallerySection>

      <GallerySection title="Title bar controls">
        <div className="flex w-full items-center gap-2.5">
          <TargetPicker
            devices={devices}
            target={target}
            open={picker}
            onOpenChange={setPicker}
            onPick={setTarget}
            onSetup={() => notify({ tone: 'info', text: 'Set up a new stick…' })}
            onPair={() => notify({ tone: 'info', text: 'Pair a device over Wi‑Fi…' })}
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
              exportLogs: () => undefined,
              vvd: { busy: null, start: () => undefined, stop: () => undefined },
              screenshot: { busy: false, unavailable: null, take: () => undefined },
              setup: () => undefined,
              pair: () => undefined,
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

      <GallerySection title="Remote keys">
        <div className="flex flex-wrap items-center gap-3">
          <PadButton label="Up" icon="keyboard_arrow_up" onPress={() => undefined} />
          <PadButton label="OK" text="OK" size="lg" onPress={() => undefined} />
          <PadButton label="Down" icon="keyboard_arrow_down" flash onPress={() => undefined} />
          <PadButton
            label="Home"
            icon="home"
            disabled
            disabledReason="Home can’t be sent to the Virtual Device"
            onPress={() => undefined}
          />
          <PadButton label="Play/pause" icon="play_pause" onPress={() => undefined} />
        </div>
      </GallerySection>

      <GallerySection title="Log controls">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Level"
            options={[
              { id: 'v', label: 'V', title: 'Verbose' },
              { id: 'd', label: 'D', title: 'Debug' },
              { id: 'i', label: 'I', title: 'Info' },
              { id: 'w', label: 'W', title: 'Warn' },
              { id: 'e', label: 'E', title: 'Error' }
            ]}
            value={level}
            onChange={setLevel}
          />
          <Select
            label="Package"
            options={[
              { value: 'all', label: 'All' },
              { value: 'com.example.player', label: 'com.example.player' },
              { value: 'system', label: 'System' }
            ]}
            value={logPackage}
            onChange={setLogPackage}
          />
          <ToggleButton label="Regex" pressed={regex} onChange={setRegex} mono>
            .*
          </ToggleButton>
          <ToggleButton
            icon="visibility"
            pressed={false}
            onChange={() => undefined}
            disabled
            disabledReason="Vega Virtual Device is offline"
          >
            Watch off
          </ToggleButton>
          <MenuButton
            label="Export"
            icon="download"
            size="sm"
            items={[
              {
                id: 'text',
                label: 'Plain text (.txt)',
                onSelect: () => notify({ tone: 'info', text: 'Export as plain text' })
              },
              {
                id: 'jsonl',
                label: 'JSON lines (.jsonl)',
                onSelect: () => notify({ tone: 'info', text: 'Export as JSON lines' })
              }
            ]}
          />
        </div>
      </GallerySection>

      <GallerySection title="Run steps">
        <div className="flex flex-wrap items-start gap-4">
          {RUN_STATES.map(({ label, state }) => (
            <div key={label} className="flex flex-col gap-1.5">
              <div className="text-label text-faint">{label}</div>
              <RunSteps
                state={state}
                cli="ovd run --device VirtualDevice"
                onOpenLogs={() => undefined}
              />
            </div>
          ))}
        </div>
      </GallerySection>

      <GallerySection title="Log rows">
        <div role="list" aria-label="Sample log lines" className="bg-sunken">
          {LOG_ROWS.map((entry) => (
            <LogRow key={entry.seq} entry={entry} search="tick" regex={false} />
          ))}
        </div>
      </GallerySection>

      {modal && (
        <ConfirmUninstall
          action="uninstall"
          appTitle="Sample Player"
          packageId="com.example.player"
          deviceName="Fire TV Stick 4K Select"
          onCancel={() => setModal(false)}
          onConfirm={() => setModal(false)}
        />
      )}
      {wideModal && (
        <Modal
          size="lg"
          title="Project doctor · sample-player"
          subtitle="~/dev/sample-player"
          subtitleMono
          onClose={() => setWideModal(false)}
          footer={<Button onClick={() => setWideModal(false)}>Close</Button>}
        >
          <div className="min-h-0 overflow-auto px-5 py-4 text-muted">
            {Array.from({ length: 40 }, (_, i) => (
              <p key={i}>Long content scrolls inside the dialog, line {i + 1}.</p>
            ))}
          </div>
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
