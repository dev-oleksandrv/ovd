import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { MenuButton } from '../../../src/renderer/src/ui/MenuButton'

function setup() {
  const text = vi.fn()
  const jsonl = vi.fn()
  render(
    <div>
      <MenuButton
        label="Export"
        icon="download"
        items={[
          { id: 'text', label: 'Plain text (.txt)', onSelect: text },
          { id: 'jsonl', label: 'JSON lines (.jsonl)', onSelect: jsonl }
        ]}
      />
      <p>outside</p>
    </div>
  )
  const button = screen.getByRole('button', { name: /Export/ })
  return { text, jsonl, button }
}

describe('MenuButton', () => {
  test('closed at first; a click opens the menu with its items', () => {
    const { button } = setup()
    expect(button.getAttribute('aria-haspopup')).toBe('menu')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(
      screen.getAllByRole('menuitem', { hidden: false }).map((item) => item.textContent)
    ).toEqual(['Plain text (.txt)', 'JSON lines (.jsonl)'])
    expect(screen.getByRole('menu', { name: 'Export' })).toBeTruthy()
  })

  test('choosing an item runs it and closes the menu', () => {
    const { button, text, jsonl } = setup()
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON lines (.jsonl)' }))
    expect(jsonl).toHaveBeenCalledTimes(1)
    expect(text).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  test.each([
    ['Esc', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['a click outside', () => fireEvent.mouseDown(screen.getByText('outside'))],
    [
      'a second click on the button',
      () => fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    ]
  ])('%s closes it without choosing', (_name, close) => {
    const { button, text, jsonl } = setup()
    fireEvent.click(button)
    close()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(text).not.toHaveBeenCalled()
    expect(jsonl).not.toHaveBeenCalled()
  })
})
