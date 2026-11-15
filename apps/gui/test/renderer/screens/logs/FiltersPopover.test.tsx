import { act, fireEvent, render, screen, type RenderResult } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { FiltersPopover } from '../../../../src/renderer/src/screens/logs/FiltersPopover'

const WIDTH = 460
const EDGE = 8
const NAME = 'Filter by process, thread, tag, identity, facility or boot'
const windowWidth = window.innerWidth
// Where the button's wrapper starts, from the window's left edge.
let buttonLeft = 0

afterEach(() => {
  vi.restoreAllMocks()
  window.innerWidth = windowWidth
})

function popover(): HTMLElement {
  return screen.getByRole('group', { name: NAME })
}

// jsdom has no layout: the button's wrapper starts `left` px into a window `width` px wide, and
// the popover is as wide as the real one.
function openAt(left: number, width: number): RenderResult {
  buttonLeft = left
  window.innerWidth = width
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const box = { left: buttonLeft, width: this.getAttribute('role') === 'group' ? WIDTH : 76 }
    return box as DOMRect
  })
  const view = render(<FiltersPopover filter={{}} onChange={() => undefined} />)
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
  return view
}

describe('FiltersPopover placement', () => {
  test.each([
    { name: 'opens in line with the button when it fits', left: 300, offset: 0 },
    { name: 'opens in line with the button when it just fits', left: 556, offset: 0 },
    // The window on the macOS CI runner: 1024 px wide, the button 813 px in.
    { name: 'moves left when it would pass the right edge', left: 813, offset: -257 },
    { name: 'moves left by the whole overflow, the button at the edge', left: 948, offset: -392 }
  ])('$name', ({ left, offset }) => {
    openAt(left, 1024)
    expect(popover().style.left).toBe(`${offset}px`)
    // Its right edge in the window: the button's left, the offset and its width.
    expect(left + offset + WIDTH).toBeLessThanOrEqual(1024 - EDGE)
  })

  test('follows the window as it gets narrower and wider while the popover is open', () => {
    openAt(700, 1280)
    expect(popover().style.left).toBe('0px')
    act(() => {
      window.innerWidth = 960
      window.dispatchEvent(new Event('resize'))
    })
    expect(popover().style.left).toBe(`${960 - WIDTH - EDGE - 700}px`)
    act(() => {
      window.innerWidth = 1280
      window.dispatchEvent(new Event('resize'))
    })
    expect(popover().style.left).toBe('0px')
  })

  test('follows the button when a render moves it (the toolbar wrapped)', () => {
    const view = openAt(300, 1024)
    expect(popover().style.left).toBe('0px')
    buttonLeft = 813
    view.rerender(<FiltersPopover filter={{ pid: [31000] }} onChange={() => undefined} />)
    expect(popover().style.left).toBe('-257px')
  })

  test('never starts left of the window, however narrow it is', () => {
    openAt(120, 400)
    expect(popover().style.left).toBe(`${EDGE - 120}px`)
  })

  test('opens in the window again after it was closed and the window got narrower', () => {
    openAt(700, 1280)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: NAME })).toBeNull()
    window.innerWidth = 960
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    expect(popover().style.left).toBe(`${960 - WIDTH - EDGE - 700}px`)
  })
})
