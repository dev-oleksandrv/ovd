import type { Device, LogExportFormat } from '@ovd/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { IpcResult, LogsFilter, LogsPreset, SavedLogsFilter } from '../../../../preload/api'
import { useFeedback } from '../../feedback/feedbackContext'
import {
  applyUpdate,
  emptyStore,
  markSeen,
  pause as pauseStore,
  resume as resumeStore,
  setFollow as setFollowStore,
  type LogStore
} from './logStore'
import {
  BUNDLE_CLI_NOTE,
  heldDevice,
  levelLetter,
  logsBundleCli,
  logsCli,
  logsExportCli,
  logsRemoveCli,
  logsSaveCli,
  presetMatch,
  regexError,
  withPackage,
  without
} from './logsView'

// The toast when Export has nothing to save (no session, or no shown lines).
export const NO_LINES_TO_EXPORT = 'No log lines to export'

// How long the search waits for typing to stop before it re-filters.
export const SEARCH_DEBOUNCE_MS = 300

export interface LogsValue {
  store: LogStore
  filter: LogsFilter
  // The search box as typed; it reaches the filter after the debounce.
  search: string
  regex: boolean
  regexError: string | null
  setLevel(level: string): void
  // The package picker's value: all, system or an app ID.
  setPackage(value: string): void
  // Filters on one app and one process (a crash's), answering once main has re-filtered the
  // buffer.
  showCrash(app: string, pid: number): Promise<void>
  // The built-in presets and the saved filters, and which one the filter equals (a key or a
  // name; null: Custom, F19).
  presets: LogsPreset[]
  saved: SavedLogsFilter[]
  activePreset: string | null
  // Replaces the filter with a preset's or a saved filter's, by key or name.
  applyPreset(name: string): void
  // Changes the filter (the filters popover, the process menu, a chip's remove).
  edit(change: (filter: LogsFilter) => LogsFilter): void
  // `ovd logs filter save <name>`: resolves with main's answer, for the dialog to show.
  saveFilter(name: string, force: boolean): Promise<IpcResult<null>>
  removeSaved(name: string): void
  // Saves the shown lines (up to the pause) as a bundle, after the save dialog.
  bundle(): void
  revealBundle(): void
  setSearch(text: string): void
  setRegex(on: boolean): void
  clearFilters(): void
  // The footer toggle: restart the session after every install OVD makes (default on).
  restartAfterInstall: boolean
  setRestartAfterInstall(on: boolean): void
  restart(): void
  clear(): void
  // Saves the shown lines (up to the pause) in `format`, after the save dialog.
  exportShown(format: LogExportFormat): void
  pause(): void
  resume(): void
  setFollow(on: boolean): void
  seenBottom(): void
}

// The Logs screen's session: main runs it (one per target) and pushes batched updates; this
// hook opens it for the online target and keeps the renderer's copy of the list.
export function useLogs(target: Device | undefined): LogsValue {
  const { echo, notify } = useFeedback()
  const [store, setStore] = useState<LogStore>(emptyStore)
  const [filter, setFilterState] = useState<LogsFilter>({})
  const [search, setSearchText] = useState('')
  const [regex, setRegexState] = useState(false)
  // Sessions open only for an online target; the echo and Restart use its ID even while it
  // shows offline (a reconnecting session keeps the screen).
  const device = target?.status === 'online' ? target.id : null
  // Without a target, a session main keeps while its device reconnects stands in for it.
  const targetId = target?.id ?? heldDevice(store.state, target)
  const restartAfterInstall = store.state.status === 'idle' ? true : store.state.restartAfterInstall
  const toggleRef = useRef(restartAfterInstall)
  toggleRef.current = restartAfterInstall
  // The latest filter asked for, ahead of main's answer: two quick changes (level, then
  // package) build on each other instead of the second undoing the first.
  const filterRef = useRef<LogsFilter>({})
  const [presets, setPresets] = useState<LogsPreset[]>([])
  const [saved, setSaved] = useState<SavedLogsFilter[]>([])
  const baseRef = useRef<(filter: LogsFilter) => string | null>(() => null)
  baseRef.current = (f) => presetMatch(f, presets, saved)
  // The echo of a filter: `--preset` when it equals a preset or a saved filter.
  const cliFor = useCallback(
    (f: LogsFilter, id: string, toggle: boolean) => logsCli(f, id, toggle, baseRef.current(f)),
    []
  )

  const refreshSaved = useCallback(async () => {
    const result = await window.ovd.logs.savedList()
    if (result.ok) setSaved(result.data)
    else notify({ tone: 'error', text: `${result.error.code}: ${result.error.message}` })
  }, [notify])
  useEffect(() => {
    void window.ovd.logs.presets().then((result) => {
      if (result.ok) setPresets(result.data)
    })
    void refreshSaved()
  }, [refreshSaved])

  useEffect(() => window.ovd.logs.onUpdate((update) => setStore((s) => applyUpdate(s, update))), [])

  // Main stops the old session itself when the target changes (or goes away); a new one
  // starts when the screen is shown for an online target.
  useEffect(() => {
    if (device !== null) void window.ovd.logs.open(device)
  }, [device])

  // Main went idle (the target changed) while this screen is shown: start again.
  const idle = store.state.status === 'idle' && store.session > 0
  useEffect(() => {
    if (idle && device !== null) void window.ovd.logs.open(device)
  }, [idle, device])

  // Echo the CLI equivalent once per session, as soon as it runs or reconnects: a session can
  // open straight into `reconnecting` when the device drops while its stream starts.
  const liveSession =
    (store.state.status === 'running' || store.state.status === 'reconnecting') &&
    store.state.device === targetId
      ? store.session
      : null
  useEffect(() => {
    if (liveSession !== null && targetId !== null) {
      echo(cliFor(filterRef.current, targetId, toggleRef.current))
    }
  }, [liveSession, targetId, echo, cliFor])

  const apply = useCallback(
    async (next: LogsFilter) => {
      const previous = filterRef.current
      filterRef.current = next
      setFilterState(next)
      const result = await window.ovd.logs.setFilter(next)
      const cli = targetId === null ? undefined : cliFor(next, targetId, toggleRef.current)
      if (!result.ok) {
        if (filterRef.current === next) {
          filterRef.current = previous
          setFilterState(previous)
        }
        notify({ tone: 'error', text: result.error.message, ...(cli ? { cli } : {}) })
        return
      }
      notify({ tone: 'info', text: 'Log filter applied', ...(cli ? { cli } : {}) })
    },
    [targetId, notify, cliFor]
  )

  // The search reaches the filter after typing stops; an invalid regex changes nothing.
  const invalid = regexError(search, regex)
  useEffect(() => {
    const current = filterRef.current
    const nextSearch = search === '' ? undefined : search
    const nextRegex = regex && nextSearch !== undefined ? true : undefined
    if (invalid !== null) return
    if (current.search === nextSearch && current.regex === nextRegex) return
    const timer = setTimeout(() => {
      void apply({
        ...without(filterRef.current, 'search', 'regex'),
        ...(nextSearch === undefined ? {} : { search: nextSearch }),
        ...(nextRegex ? { regex: true } : {})
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [search, regex, invalid, apply])

  function revealBundle(): void {
    void window.ovd.logs.revealBundle().then((result) => {
      if (!result.ok)
        notify({ tone: 'error', text: `${result.error.code}: ${result.error.message}` })
    })
  }

  return {
    store,
    filter,
    search,
    regex,
    regexError: invalid,
    setLevel(level) {
      const rest = without(filterRef.current, 'level')
      void apply(level === 'v' ? rest : { ...rest, level })
    },
    setPackage(value) {
      void apply(withPackage(filterRef.current, value))
    },
    showCrash: (app, pid) => apply({ ...withPackage(filterRef.current, app), pid: [pid] }),
    presets,
    saved,
    activePreset: presetMatch(filter, presets, saved),
    applyPreset(name) {
      const found =
        presets.find((preset) => preset.key === name)?.filter ??
        saved.find((item) => item.valid && item.name === name)?.filter
      if (found === undefined) return
      // The search box follows the filter: a preset's search shows up there.
      setSearchText(found.search ?? '')
      setRegexState(found.search !== undefined && found.regex === true)
      // The toolbar speaks level letters; a preset may spell the level as a name.
      const { level, ...rest } = found
      const letter = levelLetter(level)
      void apply({ ...rest, ...(level === undefined || letter === 'v' ? {} : { level: letter }) })
    },
    edit: (change) => void apply(change(filterRef.current)),
    async saveFilter(name, force) {
      // Never a boot ID: it's bound to one boot (F20).
      const filterToSave = without(filterRef.current, 'boot')
      const result = await window.ovd.logs.savedSave({
        name,
        filter: filterToSave,
        ...(force ? { force: true } : {})
      })
      if (result.ok) {
        await refreshSaved()
        notify({
          tone: 'info',
          text: `Saved the filter ${name}`,
          cli: logsSaveCli(name, filterToSave, baseRef.current(filterToSave), force)
        })
      }
      return result
    },
    removeSaved(name) {
      void window.ovd.logs.savedRemove(name).then(async (result) => {
        const cli = logsRemoveCli(name)
        if (!result.ok) {
          notify({ tone: 'error', text: `${result.error.code}: ${result.error.message}`, cli })
          return
        }
        await refreshSaved()
        notify({ tone: 'info', text: `Deleted the saved filter ${name}`, cli })
      })
    },
    bundle() {
      const through = store.pausedThrough
      const preset = baseRef.current(filterRef.current)
      const request = {
        ...(through === null ? {} : { throughSeq: through }),
        ...(preset === null ? {} : { preset })
      }
      void window.ovd.logs.bundle(request).then((result) => {
        const cli =
          targetId === null
            ? undefined
            : logsBundleCli(filterRef.current, targetId, baseRef.current(filterRef.current))
        if (!result.ok) {
          // The error toast names the code (F46).
          notify({
            tone: 'error',
            text: `${result.error.code}: ${result.error.message}`,
            ...(cli ? { cli } : {})
          })
          return
        }
        const bundled = result.data
        if (bundled.status === 'empty') notify({ tone: 'info', text: 'No log lines to bundle' })
        if (bundled.status !== 'saved') return
        notify({
          tone: 'info',
          text: `Bundled ${bundled.lines} lines to ${bundled.path}. ${BUNDLE_CLI_NOTE}`,
          action: { label: 'Reveal', run: () => revealBundle() },
          ...(cli ? { cli } : {})
        })
        notify({ tone: 'info', text: bundled.warning })
      })
    },
    revealBundle: () => revealBundle(),
    setSearch: setSearchText,
    setRegex: setRegexState,
    clearFilters() {
      setSearchText('')
      setRegexState(false)
      void apply({})
    },
    restartAfterInstall,
    setRestartAfterInstall(on) {
      void window.ovd.logs.setRestartAfterInstall(on).then((result) => {
        const cli = targetId === null ? undefined : cliFor(filterRef.current, targetId, on)
        if (!result.ok) {
          notify({ tone: 'error', text: result.error.message, ...(cli ? { cli } : {}) })
          return
        }
        notify({
          tone: 'info',
          text: on ? 'Restart session after install: on' : 'Restart session after install: off',
          ...(cli ? { cli } : {})
        })
      })
    },
    restart() {
      if (targetId === null) return
      const id = targetId
      void window.ovd.logs.restart(id).then((result) => {
        const cli = cliFor(filterRef.current, id, toggleRef.current)
        if (result.ok) {
          notify({
            tone: 'info',
            text: `Restarted the log session on ${target?.name ?? id}`,
            cli
          })
        } else {
          notify({ tone: 'error', text: result.error.message, cli })
        }
      })
    },
    clear() {
      void window.ovd.logs.clear()
    },
    exportShown(format) {
      const through = store.pausedThrough
      const request = { format, ...(through === null ? {} : { throughSeq: through }) }
      void window.ovd.logs.export(request).then((result) => {
        if (!result.ok) {
          const cli =
            targetId === null ? undefined : cliFor(filterRef.current, targetId, toggleRef.current)
          notify({ tone: 'error', text: result.error.message, ...(cli ? { cli } : {}) })
          return
        }
        const exported = result.data
        if (exported.status === 'empty') notify({ tone: 'info', text: NO_LINES_TO_EXPORT })
        if (exported.status !== 'saved') return
        const cli =
          targetId === null
            ? undefined
            : logsExportCli(
                filterRef.current,
                targetId,
                toggleRef.current,
                exported,
                baseRef.current(filterRef.current)
              )
        notify({
          tone: 'info',
          text: `Exported ${exported.lines} lines to ${exported.path}`,
          ...(cli ? { cli } : {})
        })
      })
    },
    pause: () => setStore(pauseStore),
    resume: () => setStore(resumeStore),
    setFollow: (on) => setStore((s) => setFollowStore(s, on)),
    seenBottom: () => setStore(markSeen)
  }
}
