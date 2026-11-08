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
  const device = target?.status === 'online' ? target.id : null
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

  // Echo the CLI equivalent once the session runs.
  const runningSession =
    store.state.status === 'running' && store.state.device === device ? store.session : null
  useEffect(() => {
    if (runningSession !== null && device !== null) echo(logsCli(filterRef.current, device))
  }, [runningSession, device, echo])

  const apply = useCallback(
    async (next: LogsFilter) => {
      const previous = filterRef.current
      filterRef.current = next
      setFilterState(next)
      const result = await window.ovd.logs.setFilter(next)
      const cli = device === null ? undefined : logsCli(next, device)
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
    [device, notify]
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
    restart() {
      if (device === null) return
      void window.ovd.logs.restart(device).then((result) => {
        const cli = logsCli(filterRef.current, device)
        if (result.ok) {
          notify({
            tone: 'info',
            text: `Restarted the log session on ${target?.name ?? device}`,
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
        const cli = device === null ? undefined : logsCli(filterRef.current, device)
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
