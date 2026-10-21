import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { DatabaseWrapper } from '../db.js'
import { rewriteShowId } from './show-id.repository.js'
import { createTestDb } from '../test-helpers.js'

let db: DatabaseWrapper
let cleanup: () => void

beforeEach(async () => {
  const t = await createTestDb()
  db = t.db
  cleanup = t.cleanup
})

afterEach(() => cleanup())

function seedShow(id: string, thumbnail: string): void {
  db.run(`INSERT INTO watchlist (id,name,thumbnail,status) VALUES (?,?,?,'Watching')`, [
    id,
    `name-${id}`,
    thumbnail,
  ])
  db.run(`INSERT INTO shows_meta (id,name,thumbnail,anilistId,isAdult) VALUES (?,?,?,?,0)`, [
    id,
    `name-${id}`,
    thumbnail,
    1,
  ])
  db.run(`INSERT INTO watched_episodes (showId,episodeNumber) VALUES (?,'1')`, [id])
  db.run(`INSERT INTO queue (showId,episodeNumber,queue_order) VALUES (?,'1',0)`, [id])
  db.run(`INSERT INTO dismissed_notifications (showId,episodeNumber) VALUES (?,'1')`, [id])
  db.run(`INSERT INTO discovered_notifications (showId,episodeNumber) VALUES (?,'2')`, [id])
}

test('rewriteShowId moves every row that points at the show', async () => {
  seedShow('old', 'thumb-old')

  await rewriteShowId(db, 'old', 'new', { anilistId: 42 })

  assert.equal(db.get('SELECT id FROM watchlist WHERE id=?', ['old']), undefined)
  assert.equal(db.get('SELECT id FROM shows_meta WHERE id=?', ['old']), undefined)
  assert.equal(db.get('SELECT showId FROM watched_episodes WHERE showId=?', ['old']), undefined)
  assert.equal(db.get('SELECT showId FROM queue WHERE showId=?', ['old']), undefined)
  assert.equal(
    db.get('SELECT showId FROM dismissed_notifications WHERE showId=?', ['old']),
    undefined
  )
  assert.equal(
    db.get('SELECT showId FROM discovered_notifications WHERE showId=?', ['old']),
    undefined
  )

  assert.equal(db.get<{ id: string }>('SELECT id FROM watchlist WHERE id=?', ['new'])?.id, 'new')
  assert.equal(db.get<{ id: string }>('SELECT id FROM shows_meta WHERE id=?', ['new'])?.id, 'new')
  assert.equal(
    db.get<{ showId: string }>('SELECT showId FROM watched_episodes WHERE showId=?', ['new'])
      ?.showId,
    'new'
  )
  assert.equal(
    db.get<{ showId: string }>('SELECT showId FROM queue WHERE showId=?', ['new'])?.showId,
    'new'
  )
})

test('rewriteShowId writes the new anilistId and keeps the source thumbnail', async () => {
  seedShow('old', 'thumb-old')

  await rewriteShowId(db, 'old', 'new', { anilistId: 42 })

  assert.equal(
    db.get<{ anilistId: number }>('SELECT anilistId FROM shows_meta WHERE id=?', ['new'])
      ?.anilistId,
    42
  )
  assert.equal(
    db.get<{ thumbnail: string }>('SELECT thumbnail FROM watchlist WHERE id=?', ['new'])?.thumbnail,
    'thumb-old'
  )
  assert.equal(
    db.get<{ thumbnail: string }>('SELECT thumbnail FROM shows_meta WHERE id=?', ['new'])
      ?.thumbnail,
    'thumb-old'
  )
})

test('rewriteShowId prefers the thumbnail override when one is given', async () => {
  seedShow('old', 'thumb-old')

  await rewriteShowId(db, 'old', 'new', { anilistId: 42, thumbnail: 'thumb-fresh' })

  assert.equal(
    db.get<{ thumbnail: string }>('SELECT thumbnail FROM watchlist WHERE id=?', ['new'])?.thumbnail,
    'thumb-fresh'
  )
  assert.equal(
    db.get<{ thumbnail: string }>('SELECT thumbnail FROM shows_meta WHERE id=?', ['new'])
      ?.thumbnail,
    'thumb-fresh'
  )
})

test('rewriteShowId keeps the target row when the target already exists', async () => {
  seedShow('dup', 'thumb-dup')
  db.run(
    `INSERT INTO watchlist (id,name,thumbnail,status) VALUES ('keep','keep','thumb-keep','Watching')`
  )

  await rewriteShowId(db, 'dup', 'keep', { anilistId: 7 })

  assert.equal(db.get('SELECT id FROM watchlist WHERE id=?', ['dup']), undefined)
  assert.equal(
    db.get<{ thumbnail: string }>('SELECT thumbnail FROM watchlist WHERE id=?', ['keep'])
      ?.thumbnail,
    'thumb-keep'
  )
})
