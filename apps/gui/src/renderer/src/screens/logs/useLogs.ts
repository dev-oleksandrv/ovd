import type { Device } from '@ovd/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LogsFilter } from '../../../../preload/api'
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
import { logsCli, regexError, withPackage, without } from './logsView'

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
  setSearch(text: string): void
  setRegex(on: boolean): void
  clearFilters(): void
  // The footer toggle: restart the session after every install OVD makes (default on).
  restartAfterInstall: boolean
  setRestartAfterInstall(on: boolean): void
  restart(): void
  clear(): void
  exportShown(): void
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
  const targetId = target?.id ?? null
  const restartAfterInstall = store.state.status === 'idle' ? true : store.state.restartAfterInstall
  const toggleRef = useRef(restartAfterInstall)
  toggleRef.current = restartAfterInstall
  // The latest filter asked for, ahead of main's answer: two quick changes (level, then
  // package) build on each other instead of the second undoing the first.
  const filterRef = useRef<LogsFilter>({})

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
      echo(logsCli(filterRef.current, targetId, toggleRef.current))
    }
  }, [liveSession, targetId, echo])

  const apply = useCallback(
    async (next: LogsFilter) => {
      const previous = filterRef.current
      filterRef.current = next
      setFilterState(next)
      const result = await window.ovd.logs.setFilter(next)
      const cli = targetId === null ? undefined : logsCli(next, targetId, toggleRef.current)
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
    [targetId, notify]
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
        const cli = targetId === null ? undefined : logsCli(filterRef.current, targetId, on)
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
        const cli = logsCli(filterRef.current, id, toggleRef.current)
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
    exportShown() {
      const through = store.pausedThrough ?? undefined
      void window.ovd.logs.export(through).then((result) => {
        const cli =
          targetId === null ? undefined : logsCli(filterRef.current, targetId, toggleRef.current)
        if (!result.ok) {
          notify({ tone: 'error', text: result.error.message, ...(cli ? { cli } : {}) })
        } else if (result.data) {
          notify({
            tone: 'info',
            text: `Exported ${result.data.lines} lines to ${result.data.path}`,
            ...(cli ? { cli } : {})
          })
        }
      })
    },
    pause: () => setStore(pauseStore),
    resume: () => setStore(resumeStore),
    setFollow: (on) => setStore((s) => setFollowStore(s, on)),
    seenBottom: () => setStore(markSeen)
  }
}
