import { expect, test } from 'vitest'
import { parseFibTrie } from '../../src/index.js'
import { fixture } from '../support/fixtures.js'

test('finds the stick’s address, not loopback', () => {
  expect(parseFibTrie(fixture('0.24/vda-shell-fib-trie/stick.txt'))).toEqual(['192.0.2.42'])
})

test('a stick on no network has no address', () => {
  const loopbackOnly = [
    'Main:',
    '  +-- 127.0.0.0/8 2 0 2',
    '     |-- 127.0.0.1',
    '        /32 host LOCAL'
  ].join('\n')
  expect(parseFibTrie(loopbackOnly)).toEqual([])
})

test.each(['', '/bin/sh: cat: not found'])('rejects %j', (out) => {
  expect(() => parseFibTrie(out)).toThrow(expect.objectContaining({ code: 'UNEXPECTED_OUTPUT' }))
})
