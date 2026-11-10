import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ToggleButton } from '../../../src/renderer/src/ui/ToggleButton'

describe('ToggleButton', () => {
  test.each([true, false])('shows aria-pressed=%s and toggles on click', (pressed) => {
    const onChange = vi.fn()
    render(
      <ToggleButton label="Regex" pressed={pressed} onChange={onChange} mono>
        .*
      </ToggleButton>
    )
    const button = screen.getByRole('button', { name: 'Regex' })
    expect(button.getAttribute('aria-pressed')).toBe(String(pressed))
    fireEvent.click(button)
    expect(onChange).toHaveBeenCalledWith(!pressed)
  })

  test('disabled: says why and ignores clicks', () => {
    const onChange = vi.fn()
    render(
      <ToggleButton
        icon="visibility"
        pressed={false}
        onChange={onChange}
        disabled
        disabledReason="Pick a target first"
      >
        Watch off
      </ToggleButton>
    )
    const button = screen.getByRole('button', { name: 'Watch off' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('Pick a target first')
    fireEvent.click(button)
    expect(onChange).not.toHaveBeenCalled()
  })
})
