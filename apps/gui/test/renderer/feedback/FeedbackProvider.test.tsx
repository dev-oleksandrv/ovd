import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FeedbackProvider } from '../../../src/renderer/src/feedback/FeedbackProvider'
import { useFeedback } from '../../../src/renderer/src/feedback/feedbackContext'
import { ToastViewport } from '../../../src/renderer/src/feedback/ToastViewport'
import { StatusBar } from '../../../src/renderer/src/frame/StatusBar'

function Trigger() {
  const { notify } = useFeedback()
  return (
    <button
      onClick={() =>
        notify({ tone: 'ok', text: 'Installed Sample Player', cli: 'ovd install player.vpkg' })
      }
    >
      go
    </button>
  )
}

function renderFeedback() {
  render(
    <FeedbackProvider>
      <Trigger />
      <ToastViewport />
      <StatusBar />
    </FeedbackProvider>
  )
}

describe('feedback', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('a toast shows its CLI equivalent and the status bar echoes it', () => {
    renderFeedback()
    act(() => screen.getByText('go').click())
    expect(screen.getByRole('status').textContent).toContain('Installed Sample Player')
    expect(screen.getAllByText('$ ovd install player.vpkg')).toHaveLength(2)
  })

  test('toasts disappear after about 4 seconds; the echo stays', () => {
    renderFeedback()
    act(() => screen.getByText('go').click())
    act(() => vi.advanceTimersByTime(4000))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByTitle('Copy CLI equivalent').textContent).toContain(
      '$ ovd install player.vpkg'
    )
  })
})
