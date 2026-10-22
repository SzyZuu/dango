import type { DatabaseWrapper } from '../../db.js'

type Listener = (updating: boolean) => void
const activity = new WeakMap<DatabaseWrapper, { active: number; listeners: Set<Listener> }>()

function state(db: DatabaseWrapper) {
  let value = activity.get(db)
  if (!value) {
    value = { active: 0, listeners: new Set() }
    activity.set(db, value)
  }
  return value
}

function publish(db: DatabaseWrapper) {
  const value = state(db)
  for (const listener of value.listeners) {
    // A disconnected observer must never interrupt the tracker request.
    try {
      listener(value.active > 0)
    } catch {
      /* Observer has disconnected. */
    }
  }
}

export function subscribeMalUpdates(db: DatabaseWrapper, listener: Listener) {
  const value = state(db)
  value.listeners.add(listener)
  listener(value.active > 0)
  return () => {
    value.listeners.delete(listener)
  }
}

export async function withMalUpdate<T>(db: DatabaseWrapper, update: () => Promise<T>): Promise<T> {
  const value = state(db)
  if (value.active++ === 0) publish(db)
  try {
    return await update()
  } finally {
    if (--value.active === 0) publish(db)
  }
}
