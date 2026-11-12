import type { Device, ScreenshotResult } from '@ovd/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScreenFramePush, ScreenState, ScreenshotTaken } from '../../../../preload/api'
import { useFeedback } from '../../feedback/feedbackContext'
import { fileName } from '../../screenshot/screenshotView'
import { drawable, refreshCli } from './screenPanelView'

const IDLE: ScreenState = { status: 'idle', target: null }

// A stick's latest screenshot as shown: its Blob URL, and how many sends the device had taken
// when it was shot.
interface Shown {
  shot: ScreenshotResult
  url: string
  sentAt: number
}

export interface ScreenValue {
  live: ScreenState
  // The live view's canvas; frames are drawn into it straight from IPC, without a re-render.
  canvasRef: (canvas: HTMLCanvasElement | null) => void
  retry(): void
  stick: {
    shot: ScreenshotResult | null
    url: string | null
    stale: boolean
    busy: boolean
    refresh(): Promise<void>
  }
}

// The Remote screen's view of the target's screen. The Virtual Device: main streams it while
// the screen is shown; each frame is drawn, then acked, so main sends the next. While the window
// is hidden nothing is drawn or acked: the stream stays open and flow control holds the
// emulator. A stick: its latest screenshot, from Refresh or the header's Screenshot.
export function useScreen(
  target: Device | undefined,
  sentCount: number,
  latest: ScreenshotTaken | null
): ScreenValue {
  const { notify } = useFeedback()
  const [live, setLive] = useState<ScreenState>(IDLE)
  const vvd = target?.kind === 'vvd' && target.status === 'online' ? target.id : null
  const stick = target?.kind === 'stick' && target.status === 'online' ? target.id : null

  useEffect(() => window.ovd.screen.onState(setLive), [])

  // Started for the online Virtual Device and again whenever it comes back online; stopped when
  // it goes away, the target changes or the screen unmounts.
  useEffect(() => {
    if (vvd === null) return
    let current = true
    void window.ovd.screen.start(vvd).then((s) => {
      if (current) setLive(s)
    })
    return () => {
      current = false
      void window.ovd.screen.stop()
    }
  }, [vvd])

  const retry = useCallback(() => {
    if (vvd !== null) void window.ovd.screen.start(vvd).then(setLive)
  }, [vvd])

  const canvas = useRef<HTMLCanvasElement | null>(null)
  const held = useRef<ScreenFramePush | null>(null)
  const drawn = useRef(0)

  // Draws the held frame and acks it; a frame of the wrong size is dropped (acked, not drawn).
  const show = useCallback(() => {
    const frame = held.current
    const el = canvas.current
    if (!frame || !el || document.visibilityState === 'hidden') return
    held.current = null
    if (drawable(frame)) {
      if (el.width !== frame.width) el.width = frame.width
      if (el.height !== frame.height) el.height = frame.height
      const context = el.getContext('2d')
      if (context) {
        // A view on the cloned bytes, not a copy. IPC's structured clone always gives an
        // ArrayBuffer (never a SharedArrayBuffer), which ImageData needs.
        const pixels = new Uint8ClampedArray(
          frame.pixels.buffer as ArrayBuffer,
          frame.pixels.byteOffset,
          frame.pixels.length
        )
        context.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0)
        drawn.current++
        el.dataset.frames = String(drawn.current)
      }
    }
    void window.ovd.screen.ack(frame.seq)
  }, [])

  useEffect(
    () =>
      window.ovd.screen.onFrame((frame) => {
        held.current = frame
        show()
      }),
    [show]
  )

  useEffect(() => {
    document.addEventListener('visibilitychange', show)
    return () => document.removeEventListener('visibilitychange', show)
  }, [show])

  const canvasRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      canvas.current = el
      if (!el) return
      el.dataset.frames = String(drawn.current)
      // A frame that arrived before the canvas mounted.
      show()
    },
    [show]
  )

  const [shown, setShown] = useState<Shown | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const sent = useRef(sentCount)

  const last = useRef<Shown | null>(null)
  useEffect(() => {
    sent.current = sentCount
  }, [sentCount])

  // The previous URL is revoked as the next one shows.
  const display = useCallback((shot: ScreenshotResult, png: Uint8Array) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(png)], { type: 'image/png' }))
    if (last.current) URL.revokeObjectURL(last.current.url)
    const next = { shot, url, sentAt: sent.current }
    last.current = next
    setShown(next)
  }, [])

  // The last URL goes with the screen.
  useEffect(
    () => () => {
      if (last.current) URL.revokeObjectURL(last.current.url)
    },
    []
  )

  // The header's Screenshot of this stick shows here too.
  useEffect(() => {
    if (!latest || stick === null || latest.target.id !== stick) return
    if (last.current && last.current.shot.takenAt >= latest.takenAt) return
    let current = true
    void window.ovd.screen.image(latest.path).then((result) => {
      if (current && result.ok) display(latest, result.data)
    })
    return () => {
      current = false
    }
  }, [latest, stick, display])

  const refresh = useCallback(async () => {
    if (stick === null || running.current) return
    running.current = true
    setBusy(true)
    const cli = refreshCli(stick)
    try {
      const result = await window.ovd.screen.refresh(stick)
      if (result.ok) {
        display(result.data.shot, result.data.png)
        notify({ tone: 'ok', text: `Saved ${fileName(result.data.shot.path)}`, cli })
      } else notify({ tone: 'error', text: result.error.message, cli })
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [stick, display, notify])

  const forTarget = shown && shown.shot.target.id === target?.id ? shown : null
  return {
    live,
    canvasRef,
    retry,
    stick: {
      shot: forTarget?.shot ?? null,
      url: forTarget?.url ?? null,
      stale: forTarget !== null && sentCount > forTarget.sentAt,
      busy,
      refresh
    }
  }
}
