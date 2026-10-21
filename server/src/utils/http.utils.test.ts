import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchWithRetry, withRetry } from './http.utils.js'

test('withRetry stops at the first result and gives up after the retries', async () => {
  let calls = 0
  const ok = await withRetry(
    async () => {
      calls += 1
      return calls < 2 ? null : 'done'
    },
    { retries: 3, baseDelayMs: 1 }
  )
  assert.equal(ok, 'done')
  assert.equal(calls, 2)

  calls = 0
  const failed = await withRetry(
    async () => {
      calls += 1
      return null
    },
    { retries: 2, baseDelayMs: 1 }
  )
  assert.equal(failed, null)
  assert.equal(calls, 3)
})

test('fetchWithRetry gives the last response back when the retries run out', async () => {
  const original = globalThis.fetch
  let body = 'the body'
  globalThis.fetch = (async () =>
    new Response(body, { status: 503 })) as unknown as typeof globalThis.fetch
  try {
    const res = await fetchWithRetry('https://example.invalid', {}, { retries: 1, baseDelayMs: 1 })
    assert.equal(res.status, 503)
    body = 'the body'
    assert.equal(await res.text(), 'the body')
  } finally {
    globalThis.fetch = original
  }
})
