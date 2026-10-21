import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cached } from './cache.js'
import type { TrpcContext } from './context.js'

function fakeCtx(): TrpcContext {
  const store = new Map<string, unknown>()
  return {
    apiCache: {
      get: <T>(key: string) => store.get(key) as T | undefined,
      set: (key: string, value: unknown) => {
        store.set(key, value)
      },
    },
  } as unknown as TrpcContext
}

test('cached produces once and then serves the cached value', async () => {
  const ctx = fakeCtx()
  let calls = 0
  const produce = async () => {
    calls++
    return ['a']
  }
  assert.deepEqual(await cached(ctx, 'k', 60, produce), ['a'])
  assert.deepEqual(await cached(ctx, 'k', 60, produce), ['a'])
  assert.equal(calls, 1)
})

test('cached does not store a value the validator rejects', async () => {
  const ctx = fakeCtx()
  let calls = 0
  const produce = async () => {
    calls++
    return [] as string[]
  }
  const validate = (d: string[]) => d.length > 0
  assert.deepEqual(await cached(ctx, 'k', 60, produce, validate), [])
  assert.deepEqual(await cached(ctx, 'k', 60, produce, validate), [])
  assert.equal(calls, 2)
})
