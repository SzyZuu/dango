import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyEmbedPatches, mirrorUrls } from './proxy.js'

test('mirrorUrls returns the url itself when there are no mirrors', () => {
  assert.deepEqual(mirrorUrls('https://host/x.m3u8', undefined), ['https://host/x.m3u8'])
  assert.deepEqual(mirrorUrls('https://host/x.m3u8', []), ['https://host/x.m3u8'])
})

test('mirrorUrls adds one candidate per mirror host', () => {
  assert.deepEqual(mirrorUrls('https://host/a/b.m3u8', ['m1.example', 'm2.example']), [
    'https://host/a/b.m3u8',
    'https://m1.example/a/b.m3u8',
    'https://m2.example/a/b.m3u8',
  ])
})

test('mirrorUrls skips a mirror that is the same host', () => {
  assert.deepEqual(mirrorUrls('https://host/a.m3u8', ['host', 'other.example']), [
    'https://host/a.m3u8',
    'https://other.example/a.m3u8',
  ])
})

test('applyEmbedPatches rewrites relative urls to absolute ones', () => {
  const html = '<html><body><script src="/js/app.js"></script></body></html>'
  const patched = applyEmbedPatches(html, new URL('https://embed.example/watch/1'))

  assert.ok(patched)
  assert.match(patched, /src="https:\/\/embed\.example\/js\/app\.js"/)
})

test('applyEmbedPatches injects the hls and end bridge patches', () => {
  const html =
    '<html><body><script src="/js/plyr.min.js"></script><script src="/js/hls.min.js"></script></body></html>'
  const patched = applyEmbedPatches(html, new URL('https://embed.example/watch/1'))

  assert.ok(patched)
  assert.match(patched, /Plyr\.defaults\.iconUrl/)
  assert.match(patched, /Hls\.prototype\.loadSource/)
  assert.match(patched, /ANI_WEB_MEDIA_ENDED/)
})

test('applyEmbedPatches keeps a page that has nothing to patch', () => {
  const html = '<html><body>plain</body></html>'
  const patched = applyEmbedPatches(html, new URL('https://embed.example/watch/1'))

  assert.ok(patched, 'a page with a body must not be rejected')
  assert.match(patched, /plain/)
})

test('applyEmbedPatches rejects a body that is not html at all', () => {
  assert.equal(applyEmbedPatches('not html', new URL('https://embed.example/')), null)
  assert.equal(applyEmbedPatches('', new URL('https://embed.example/')), null)
})
