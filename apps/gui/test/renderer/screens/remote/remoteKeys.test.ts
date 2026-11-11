import { describe, expect, test } from 'vitest'
import {
  keyFor,
  overlayOpen,
  type RemoteKeyEvent
} from '../../../../src/renderer/src/screens/remote/remoteKeys'

const event = (key: string, fields: Partial<RemoteKeyEvent> = {}): RemoteKeyEvent => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  repeat: false,
  defaultPrevented: false,
  target: document.body,
  ...fields
})
const stick = { backend: 'inputd-cli' as const, overlayOpen: false }

function element(html: string, selector?: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  const found = selector ? host.querySelector(selector) : host.firstElementChild
  if (!found) throw new Error('no element')
  return found
}

describe('keyFor', () => {
  test.each([
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down'],
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
    ['Enter', 'ok'],
    ['Escape', 'back'],
    ['Backspace', 'back'],
    [' ', 'play-pause'],
    ['h', 'home'],
    ['H', 'home'],
    ['m', 'menu'],
    [',', 'rewind'],
    ['.', 'fast-forward'],
    ['a', null],
    ['Tab', null]
  ])('%j → %s', (key, expected) => {
    expect(keyFor(event(key), stick)).toBe(expected)
  })

  test.each<[string, Partial<RemoteKeyEvent>]>([
    ['⌘', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['a held key repeating', { repeat: true }],
    ['an event already handled', { defaultPrevented: true }]
  ])('ignores %s', (_name, fields) => {
    expect(keyFor(event('ArrowUp', fields), stick)).toBeNull()
  })

  test.each([
    ['an input', '<input />'],
    ['a textarea', '<textarea></textarea>'],
    ['a select', '<select></select>'],
    ['contenteditable', '<div contenteditable="true"></div>'],
    ['a tab', '<div role="tab"></div>'],
    ['a menu item', '<div role="menuitem"></div>'],
    ['an option', '<div role="option"></div>']
  ])('ignores keys aimed at %s', (_name, html) => {
    expect(keyFor(event('ArrowUp', { target: element(html) }), stick)).toBeNull()
  })

  test.each([
    ['a button', '<button>x</button>'],
    ['a link', '<a href="#">x</a>'],
    ['a role=button', '<div role="button"></div>']
  ])('on %s, Enter and Space are its own; arrows and Esc still reach the remote', (_name, html) => {
    const target = element(html)
    expect(keyFor(event('Enter', { target }), stick)).toBeNull()
    expect(keyFor(event(' ', { target }), stick)).toBeNull()
    expect(keyFor(event('ArrowDown', { target }), stick)).toBe('down')
    expect(keyFor(event('Escape', { target }), stick)).toBe('back')
  })

  test('ignores keys inside a field’s or a button’s children too', () => {
    expect(
      keyFor(event('Enter', { target: element('<button><span>x</span></button>', 'span') }), stick)
    ).toBeNull()
    expect(
      keyFor(event('ArrowUp', { target: element('<label><input /></label>', 'input') }), stick)
    ).toBeNull()
  })

  test('ignores everything while a dialog or menu is open', () => {
    expect(keyFor(event('ArrowUp'), { ...stick, overlayOpen: true })).toBeNull()
  })

  test('Home is null on the Virtual Device, which can’t take it', () => {
    expect(keyFor(event('h'), { backend: 'grpc', overlayOpen: false })).toBeNull()
    expect(keyFor(event('m'), { backend: 'grpc', overlayOpen: false })).toBe('menu')
  })
})

describe('overlayOpen', () => {
  test('true while a dialog or a menu is in the page', () => {
    document.body.innerHTML = ''
    expect(overlayOpen()).toBe(false)
    element('<div role="dialog"></div>')
    expect(overlayOpen()).toBe(true)
    document.body.innerHTML = ''
    element('<div role="menu"></div>')
    expect(overlayOpen()).toBe(true)
    document.body.innerHTML = ''
  })
})
