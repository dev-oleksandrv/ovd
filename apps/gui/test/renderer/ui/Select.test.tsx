import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Select } from '../../../src/renderer/src/ui/Select'

const OPTIONS = [
  { value: '', label: 'All' },
  { value: 'com.example.player', label: 'com.example.player' }
]

describe('Select', () => {
  test('a labelled select showing the value', () => {
    render(<Select label="Package" options={OPTIONS} value="" onChange={() => undefined} />)
    const select = screen.getByRole('combobox', { name: 'Package' }) as HTMLSelectElement
    expect(select.value).toBe('')
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All',
      'com.example.player'
    ])
  })

  test('choosing an option reports its value', () => {
    const onChange = vi.fn()
    render(<Select label="Package" options={OPTIONS} value="" onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Package' }), {
      target: { value: 'com.example.player' }
    })
    expect(onChange).toHaveBeenCalledWith('com.example.player')
  })
})
