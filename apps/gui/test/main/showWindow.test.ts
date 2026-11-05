// @vitest-environment node
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SHOW_FALLBACK_MS, showWhenReady, type ShowableWindow } from '../../src/main/showWindow'

class FakeWindow extends EventEmitter implements ShowableWindow {
  visible = false
  destroyed = false
  shows = 0
  show(): void {
    this.shows++
    this.visible = true
  }
  isVisible(): boolean {
    return this.visible
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
}

describe('showWhenReady', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('shows the window on its first paint', () => {
    const win = new FakeWindow()
    showWhenReady(win)

    win.emit('ready-to-show')

    expect(win.shows).toBe(1)
  })

  test('shows the window after the fallback when the first paint never comes', () => {
    const win = new FakeWindow()
    showWhenReady(win)

    vi.advanceTimersByTime(SHOW_FALLBACK_MS - 1)
    expect(win.shows).toBe(0)
    vi.advanceTimersByTime(1)

    expect(win.shows).toBe(1)
  })

  test('shows it once when the first paint comes after the fallback', () => {
    const win = new FakeWindow()
    showWhenReady(win)

    vi.advanceTimersByTime(SHOW_FALLBACK_MS)
    win.emit('ready-to-show')

    expect(win.shows).toBe(1)
  })

  test('the fallback does nothing once the first paint has shown it', () => {
    const win = new FakeWindow()
    showWhenReady(win)

    win.emit('ready-to-show')
    vi.advanceTimersByTime(SHOW_FALLBACK_MS)

    expect(win.shows).toBe(1)
  })

  test('the fallback leaves a window closed meanwhile alone', () => {
    const win = new FakeWindow()
    showWhenReady(win)

    win.destroyed = true
    win.emit('closed')
    vi.advanceTimersByTime(SHOW_FALLBACK_MS)

    expect(win.shows).toBe(0)
  })
})
