import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ProcessMenu } from '../../../../src/renderer/src/screens/logs/ProcessMenu'

const WIDTH = 260
const ROW = 30

// jsdom has no layout: a menu is as wide as the real one and ROW tall per child, so the Level
// view (five levels) is taller than the root one (three actions).
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const height = this.getAttribute('role') === 'menu' ? this.childElementCount * ROW : 0
    return { width: this.getAttribute('role') === 'menu' ? WIDTH : 0, height } as DOMRect
  })
})
afterEach(() => {
  vi.restoreAllMocks()
})

function menu(x: number, y: number) {
  return render(
    <ProcessMenu
      identity="com.example.player"
      x={x}
      y={y}
      onMute={() => undefined}
      onLevel={() => undefined}
      onLimit={() => undefined}
      onClose={() => undefined}
    />
  )
}

describe('ProcessMenu placement', () => {
  test('opens where the pointer is when it fits', () => {
    menu(100, 80)
    const box = screen.getByRole('menu')
    expect(box.style.left).toBe('100px')
    expect(box.style.top).toBe('80px')
  })

  test('near the bottom-right corner it stays inside the window, also in the Level view', () => {
    menu(window.innerWidth - 4, window.innerHeight - 4)
    const box = screen.getByRole('menu')
    // Header + three actions.
    expect(box.style.left).toBe(`${window.innerWidth - WIDTH - 8}px`)
    expect(box.style.top).toBe(`${window.innerHeight - 4 * ROW - 8}px`)
    fireEvent.click(screen.getByRole('menuitem', { name: /^Level for/ }))
    // Header + five levels: taller, so it moves up.
    expect(box.style.top).toBe(`${window.innerHeight - 6 * ROW - 8}px`)
    expect(Number.parseInt(box.style.left)).toBeGreaterThanOrEqual(8)
  })
})
