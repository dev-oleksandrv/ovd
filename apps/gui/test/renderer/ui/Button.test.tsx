import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Button } from '../../../src/renderer/src/ui/Button'

describe('Button', () => {
  test('calls onClick', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Rescan</Button>)
    screen.getByRole('button', { name: 'Rescan' }).click()
    expect(onClick).toHaveBeenCalledOnce()
  })

  test('disabled: does nothing and explains why', () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} disabled disabledReason="Open a project or drop a .vpkg">
        Run
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Run' })
    button.click()
    expect(onClick).not.toHaveBeenCalled()
    expect(button.getAttribute('title')).toBe('Open a project or drop a .vpkg')
  })

  test('loading: does nothing and reports busy', () => {
    const onClick = vi.fn()
    render(
      <Button onClick={onClick} loading>
        Installing
      </Button>
    )
    const button = screen.getByRole('button', { name: /Installing/ })
    button.click()
    expect(onClick).not.toHaveBeenCalled()
    expect(button.getAttribute('aria-busy')).toBe('true')
  })

  test('danger: renders and calls onClick', () => {
    const onClick = vi.fn()
    render(
      <Button variant="danger" onClick={onClick}>
        Uninstall
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Uninstall' })
    button.click()
    expect(onClick).toHaveBeenCalledOnce()
    expect(button.className).toContain('bg-error')
  })

  test('autoFocus: focuses the button on mount', () => {
    render(
      <>
        <Button>Other</Button>
        <Button autoFocus>Cancel</Button>
      </>
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
  })
})
