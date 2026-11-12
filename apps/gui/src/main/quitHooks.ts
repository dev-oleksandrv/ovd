// The parts of Electron's `app` this needs, so tests can pass a fake.
export interface QuittingApp {
  on(event: 'before-quit', listener: (event: { preventDefault(): void }) => void): unknown
  on(event: 'will-quit', listener: () => void): unknown
  quit(): void
}

export interface QuitDeps {
  logs: { running(): boolean; stop(): Promise<void> }
  // A stick's console: `exit` has to reach it before `will-quit` SIGTERMs its group.
  input: { running(): boolean; close(): Promise<void> }
  stopAll: () => void
}

// What the app does on its way out, so no SDK process group it started outlives it.
// `before-quit` aborts the returned signal, so a probe in flight (the Doctor run's sign-in
// probe) stops its process group, and it holds the quit once until the log session's group and
// the stick's input console are gone. `will-quit` is the last synchronous net: it SIGTERMs every group still registered,
// since nothing asynchronous gets to run after it.
export function registerQuitHooks(app: QuittingApp, deps: QuitDeps): AbortSignal {
  const controller = new AbortController()
  let waited = false
  app.on('before-quit', (event) => {
    controller.abort()
    if (waited || (!deps.logs.running() && !deps.input.running())) return
    event.preventDefault()
    waited = true
    void Promise.allSettled([deps.logs.stop(), deps.input.close()]).then(() => app.quit())
  })
  app.on('will-quit', () => deps.stopAll())
  return controller.signal
}
