import { describe, expect, test } from 'vitest'
import {
  addToast,
  MAX_TOASTS,
  removeToast,
  type Toast
} from '../../../src/renderer/src/feedback/toastQueue'

const toast = (id: number): Toast => ({ id, tone: 'ok', text: `toast ${id}` })

describe('toast queue', () => {
  test('keeps at most four toasts, dropping the oldest', () => {
    let queue: Toast[] = []
    for (let id = 1; id <= 5; id++) queue = addToast(queue, toast(id))
    expect(queue).toHaveLength(MAX_TOASTS)
    expect(queue.map((t) => t.id)).toEqual([2, 3, 4, 5])
  })

  test('removes a toast by id', () => {
    expect(removeToast([toast(1), toast(2)], 1).map((t) => t.id)).toEqual([2])
  })
})
