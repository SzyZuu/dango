import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseWrapper } from '../../db.js'
import { Hono } from 'hono'
import { withMalUpdate, subscribeMalUpdates } from './mal-update-events.js'
import { registerTrackerActivity } from '../../hono/tracker-activity.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test('activity is scoped to the database and stays active until concurrent writes finish', async (t) => {
  const db = await DatabaseWrapper.create(':memory:')
  const other = await DatabaseWrapper.create(':memory:')
  t.after(() => {
    db.close()
    other.close()
  })
  const events: boolean[] = [],
    otherEvents: boolean[] = []
  const unsubscribe = subscribeMalUpdates(db, (value) => events.push(value))
  const unsubscribeOther = subscribeMalUpdates(other, (value) => otherEvents.push(value))
  const first = deferred(),
    second = deferred()
  const a = withMalUpdate(db, () => first.promise),
    b = withMalUpdate(db, () => second.promise)
  assert.deepEqual(events, [false, true])
  first.resolve()
  await a
  assert.deepEqual(events, [false, true])
  second.resolve()
  await b
  assert.deepEqual(events, [false, true, false])
  assert.deepEqual(otherEvents, [false])
  unsubscribe()
  unsubscribeOther()
})

test('failed writes clear activity, and unsubscribed observers receive nothing', async (t) => {
  const db = await DatabaseWrapper.create(':memory:')
  t.after(() => db.close())
  const events: boolean[] = []
  const unsubscribe = subscribeMalUpdates(db, (value) => events.push(value))
  await assert.rejects(
    withMalUpdate(db, async () => {
      throw new Error('Network unavailable')
    })
  )
  assert.deepEqual(events, [false, true, false])
  unsubscribe()
  await withMalUpdate(db, async () => {})
  assert.deepEqual(events, [false, true, false])
})

test('SSE reports live write activity without account data and accepts disconnects', async (t) => {
  const db = await DatabaseWrapper.create(':memory:')
  t.after(() => db.close())
  const app = new Hono()
  registerTrackerActivity(app, () => db)
  const response = await app.request('/api/tracker/mal/activity')
  assert.match(response.headers.get('Content-Type') || '', /text\/event-stream/)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const initial = decoder.decode((await reader.read()).value)
  assert.match(initial, /"updating":false/)
  const pending = deferred()
  const update = withMalUpdate(db, () => pending.promise)
  const active = decoder.decode((await reader.read()).value)
  assert.match(active, /event: mal-update/)
  assert.match(active, /data: {"updating":true}/)
  pending.resolve()
  await update
  const stopped = decoder.decode((await reader.read()).value)
  assert.match(stopped, /"updating":false/)
  await reader.cancel()
  await withMalUpdate(db, async () => {})
})

test('activity streams close cleanly before server shutdown', async (t) => {
  const db = await DatabaseWrapper.create(':memory:')
  t.after(() => db.close())
  const app = new Hono()
  registerTrackerActivity(app, () => db)
  const response = await app.request('/api/tracker/mal/activity')
  const reader = response.body!.getReader()
  await reader.read()
  const { closeTrackerActivityStreams } = await import('../../hono/tracker-activity.js')
  closeTrackerActivityStreams(db)
  assert.equal((await reader.read()).done, true)
})
