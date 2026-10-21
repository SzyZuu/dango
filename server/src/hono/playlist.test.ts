import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pinVariant } from './playlist.js'

const PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=100',
  'low.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=200',
  'mid.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=300',
  'high.m3u8',
].join('\n')

test('pinVariant keeps only the picked variant', () => {
  const pinned = pinVariant(PLAYLIST, 1)
  assert.ok(pinned)
  assert.ok(pinned.includes('mid.m3u8'))
  assert.ok(!pinned.includes('low.m3u8'))
  assert.ok(!pinned.includes('high.m3u8'))
})

test('pinVariant returns null for an index that is not in the playlist', () => {
  assert.equal(pinVariant(PLAYLIST, 9), null)
  assert.equal(pinVariant('#EXTM3U\n', 0), null)
})
