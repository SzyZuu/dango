import type { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { DatabaseWrapper } from '../db.js'
import { subscribeMalUpdates } from '../lib/tracker/mal-update-events.js'

const streams = new WeakMap<DatabaseWrapper, Set<() => void>>()

export function closeTrackerActivityStreams(db: DatabaseWrapper) {
  for (const close of streams.get(db) || []) close()
}

// Registered after the normal LAN authentication middleware. No account data is sent.
export function registerTrackerActivity(app: Hono, getDb: () => DatabaseWrapper) {
  app.get('/api/tracker/mal/activity', (c) =>
    streamSSE(c, async (stream) => {
      const db = getDb()
      const connections = streams.get(db) || new Set<() => void>()
      streams.set(db, connections)
      await new Promise<void>((resolve) => {
        let unsubscribe = () => {}
        const finish = () => {
          connections.delete(finish)
          unsubscribe()
          clearInterval(heartbeat)
          resolve()
        }
        stream.onAbort(finish)
        connections.add(finish)
        unsubscribe = subscribeMalUpdates(db, (updating) => {
          void stream
            .writeSSE({ event: 'mal-update', data: JSON.stringify({ updating }) })
            .catch(finish)
        })
        const heartbeat = setInterval(() => {
          void stream.writeSSE({ event: 'ping', data: '' }).catch(finish)
        }, 20000)
        heartbeat.unref()
      })
    })
  )
}
