import { expect, test } from 'vitest'
import { createSerialRunner, type CommandSpec, type Runner } from '../../src/index.js'

const spec = (display: string): CommandSpec => ({ file: 'vega', args: [], display })

test('runs one SDK command at a time, in call order, and keeps going after a failure', async () => {
  let active = 0
  let peak = 0
  const order: string[] = []
  const inner: Runner = {
    async run(s) {
      active++
      peak = Math.max(peak, active)
      order.push(s.display)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active--
      if (s.display === 'b') throw new Error('b failed')
      return { stdout: s.display, stderr: '', exitCode: 0, durationMs: 5, command: s.display }
    }
  }
  const runner = createSerialRunner(inner)
  const results = await Promise.allSettled(['a', 'b', 'c'].map((d) => runner.run(spec(d))))
  expect(peak).toBe(1)
  expect(order).toEqual(['a', 'b', 'c'])
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
})
