import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { FeedbackProvider } from '../../src/renderer/src/feedback/FeedbackProvider'
import { Gallery } from '../../src/renderer/src/gallery/Gallery'

describe('Gallery', () => {
  test('renders every section without crashing', () => {
    render(
      <FeedbackProvider>
        <Gallery />
      </FeedbackProvider>
    )
    for (const section of [
      'Buttons',
      'Launch verification',
      'Tabs',
      'Table',
      'Screen states',
      'Doctor rows',
      'Modal and wizard',
      'Text field',
      'Remote keys',
      'Title bar controls',
      'Log controls',
      'Log rows',
      'Run steps'
    ]) {
      expect(screen.getByText(section)).toBeTruthy()
    }
  })

  test('the sample uninstall modal asks with the new wording and a danger confirm', () => {
    render(
      <FeedbackProvider>
        <Gallery />
      </FeedbackProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open modal' }))

    const dialog = screen.getByRole('dialog', {
      name: 'Uninstall Sample Player from Fire TV Stick 4K Select?'
    })
    expect(within(dialog).getByText('Its app data is removed.')).toBeTruthy()
    expect(within(dialog).getByText('com.example.player')).toBeTruthy()
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(document.activeElement).toBe(cancel)
    expect(within(dialog).getByRole('button', { name: 'Uninstall' }).className).toContain(
      'bg-error'
    )

    fireEvent.click(cancel)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('the log controls include the Export menu button', () => {
    render(
      <FeedbackProvider>
        <Gallery />
      </FeedbackProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    const menu = screen.getByRole('menu', { name: 'Export' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((i) => i.textContent)
    ).toEqual(['Plain text (.txt)', 'JSON lines (.jsonl)'])
  })
})
