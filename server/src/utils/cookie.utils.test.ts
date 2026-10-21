import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sanitizeCfClearance, buildCfClearanceCookie } from './cookie.utils.js'

test('sanitizeCfClearance strips the cookie name, the separator and the quotes', () => {
  assert.equal(sanitizeCfClearance('cf_clearance=abc'), 'abc')
  assert.equal(sanitizeCfClearance('cf_clearance:abc'), 'abc')
  assert.equal(sanitizeCfClearance('"abc"'), 'abc')
  assert.equal(sanitizeCfClearance("'abc'"), 'abc')
  assert.equal(sanitizeCfClearance('  abc  '), 'abc')
})

test('sanitizeCfClearance returns an empty string for empty input', () => {
  assert.equal(sanitizeCfClearance(''), '')
  assert.equal(sanitizeCfClearance(null), '')
  assert.equal(sanitizeCfClearance(undefined), '')
})

test('buildCfClearanceCookie names the cookie, and nothing when there is no value', () => {
  assert.equal(buildCfClearanceCookie('cf_clearance=abc'), 'cf_clearance=abc')
  assert.equal(buildCfClearanceCookie(''), '')
  assert.equal(buildCfClearanceCookie(null), '')
})
