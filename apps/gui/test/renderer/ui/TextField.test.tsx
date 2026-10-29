import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { TextField } from '../../../src/renderer/src/ui/TextField'

describe('TextField', () => {
  test('reports typing, Enter and Escape', () => {
    const onChange = vi.fn()
    const onEnter = vi.fn()
    const onEscape = vi.fn()
    render(
      <TextField
        label="Device name"
        value="Fire TV stick"
        onChange={onChange}
        onEnter={onEnter}
        onEscape={onEscape}
      />
    )
    const input = screen.getByRole('textbox', { name: 'Device name' })
    fireEvent.change(input, { target: { value: 'Living room stick' } })
    expect(onChange).toHaveBeenCalledWith('Living room stick')
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onEnter).toHaveBeenCalledOnce()
    expect(onEscape).toHaveBeenCalledOnce()
  })
})
