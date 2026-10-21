import assert from 'node:assert/strict'
import { test } from 'node:test'
import { idFieldInput, optNum, optStr, optText, reqStr, reqStrArray } from './validation.js'

test('optStr only reads strings', () => {
  assert.equal(optStr({ a: 'x' }, 'a'), 'x')
  assert.equal(optStr({ a: 123 }, 'a'), undefined)
  assert.equal(optStr({ a: null }, 'a'), undefined)
  assert.equal(optStr({}, 'a'), undefined)
})

test('optText stringifies whatever it gets', () => {
  assert.equal(optText({ a: 123 }, 'a'), '123')
  assert.equal(optText({ a: 'x' }, 'a'), 'x')
  assert.equal(optText({ a: null }, 'a'), undefined)
})

test('optNum reads the numbers and the numeric strings', () => {
  assert.equal(optNum({ a: 12 }, 'a'), 12)
  assert.equal(optNum({ a: '12' }, 'a'), 12)
  assert.equal(optNum({ a: 'x' }, 'a'), undefined)
  assert.equal(optNum({ a: '' }, 'a'), undefined)
})

test('reqStr and reqStrArray throw on the wrong shape', () => {
  assert.throws(() => reqStr({ a: 1 }, 'a'), /must be a string/)
  assert.throws(() => reqStrArray({ a: [] }, 'a', true), /non-empty/)
  assert.deepEqual(reqStrArray({ a: ['x'] }, 'a', false), ['x'])
})

test('idFieldInput reads the named field', async () => {
  const schema = idFieldInput('mangaId')
  const ok = await schema['~standard'].validate({ mangaId: 'm' })
  assert.deepEqual(ok, { value: { mangaId: 'm' } })
  const bad = await schema['~standard'].validate({ mangaId: 1 })
  assert.ok('issues' in bad)
})
