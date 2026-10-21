import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  idFieldInput,
  optNum,
  optStr,
  optText,
  readIds,
  readLimit,
  readPage,
  reqStr,
  reqStrArray,
} from './validation.js'
import { badRequest, failed, notFound, unavailable } from './errors.js'

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

test('readIds takes the raw array and the object, and drops the duplicates', () => {
  assert.deepEqual(readIds(['a', 'b']), ['a', 'b'])
  assert.deepEqual(readIds({ ids: ['a', 'a'] }), ['a'])
  assert.throws(() => readIds([]), /non-empty/)
  assert.throws(() => readIds({}), /non-empty/)
})

test('readPage is 1+ and readLimit is clamped', () => {
  assert.equal(readPage({}), 1)
  assert.equal(readPage({ page: 0 }), 1)
  assert.equal(readPage({ page: '3' }), 3)
  assert.equal(readLimit({}), 24)
  assert.equal(readLimit({ limit: 0 }), 1)
  assert.equal(readLimit({ limit: 999 }), 100)
  assert.equal(readLimit({}, 10, 50, 'size'), 10)
})

test('the error helpers carry the tRPC codes', () => {
  assert.equal(badRequest('x').code, 'BAD_REQUEST')
  assert.equal(notFound('x').code, 'NOT_FOUND')
  assert.equal(failed('x').code, 'INTERNAL_SERVER_ERROR')
  assert.equal(unavailable('x').code, 'SERVICE_UNAVAILABLE')
  assert.equal(badRequest('x').message, 'x')
})
