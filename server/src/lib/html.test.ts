import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeHtml, stripHtml } from './html.js'

test('decodeHtml decodes the named and the numeric entities', () => {
  assert.equal(decodeHtml('a &amp; b'), 'a & b')
  assert.equal(decodeHtml('&quot;x&quot;'), '"x"')
  assert.equal(decodeHtml('it&#39;s'), "it's")
  assert.equal(decodeHtml('&#65;&#x42;'), 'AB')
  assert.equal(decodeHtml('  spaced  '), 'spaced')
})

test('stripHtml drops the tags and keeps the line breaks', () => {
  assert.equal(stripHtml('<p>one</p><p>two</p>'), 'onetwo')
  assert.equal(stripHtml('one<br/>two'), 'one\ntwo')
  assert.equal(stripHtml('a &amp; b'), 'a & b')
  assert.equal(stripHtml(undefined), '')
})
