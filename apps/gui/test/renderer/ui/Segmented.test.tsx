import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Segmented } from '../../../src/renderer/src/ui/Segmented'

const LEVELS = [
  { id: 'V', label: 'V', title: 'Verbose' },
  { id: 'E', label: 'E', title: 'Error' }
] as const

describe('Segmented', () => {
  test('a labelled radio group with the value checked', () => {
    render(<Segmented label="Level" options={[...LEVELS]} value="V" onChange={() => undefined} />)
    expect(screen.getByRole('radiogroup', { name: 'Level' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Verbose' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Error' }).getAttribute('aria-checked')).toBe('false')
  })

  test('a click selects the option', () => {
    const onChange = vi.fn()
    render(<Segmented label="Level" options={[...LEVELS]} value="V" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Error' }))
    expect(onChange).toHaveBeenCalledWith('E')
  })
})
