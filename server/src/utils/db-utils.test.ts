import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { DatabaseWrapper } from '../db.js'
import { adultNonListIds } from './db-utils.js'
import { createTestDb } from '../test-helpers.js'

let db: DatabaseWrapper
let cleanup: () => void

beforeEach(async () => {
  const t = await createTestDb()
  db = t.db
  cleanup = t.cleanup
})

afterEach(() => cleanup())

test('adultNonListIds returns the adult ids that are not in the library', async () => {
  db.run(`INSERT INTO shows_meta (id,name,isAdult) VALUES ('a','a',1)`)
  db.run(`INSERT INTO shows_meta (id,name,isAdult) VALUES ('b','b',0)`)
  db.run(`INSERT INTO watched_episodes (showId,episodeNumber) VALUES ('a','1')`)
  db.run(`INSERT INTO watched_episodes (showId,episodeNumber) VALUES ('b','1')`)

  const ids = await adultNonListIds(
    db,
    'watched_episodes',
    'watchlist',
    'showId',
    '(SELECT isAdult FROM shows_meta WHERE id = p.showId) = 1'
  )

  assert.deepEqual(ids, ['a'])
})

test('adultNonListIds skips ids that are in the library', async () => {
  db.run(`INSERT INTO shows_meta (id,name,isAdult) VALUES ('a','a',1)`)
  db.run(`INSERT INTO watched_episodes (showId,episodeNumber) VALUES ('a','1')`)
  db.run(`INSERT INTO watchlist (id,name,thumbnail,status) VALUES ('a','a','t','Watching')`)

  const ids = await adultNonListIds(
    db,
    'watched_episodes',
    'watchlist',
    'showId',
    '(SELECT isAdult FROM shows_meta WHERE id = p.showId) = 1'
  )

  assert.deepEqual(ids, [])
})

test('adultNonListIds skips ids with no meta row at all', async () => {
  db.run(`INSERT INTO watched_episodes (showId,episodeNumber) VALUES ('ghost','1')`)

  const ids = await adultNonListIds(
    db,
    'watched_episodes',
    'watchlist',
    'showId',
    '(SELECT isAdult FROM shows_meta WHERE id = p.showId) = 1'
  )

  assert.deepEqual(ids, [])
})

test('adultNonListIds returns each id once', async () => {
  db.run(`INSERT INTO shows_meta (id,name,isAdult) VALUES ('a','a',1)`)
  db.run(`INSERT INTO watched_episodes (showId,episodeNumber) VALUES ('a','1')`)
  db.run(`INSERT INTO watched_episodes (showId,episodeNumber) VALUES ('a','2')`)

  const ids = await adultNonListIds(
    db,
    'watched_episodes',
    'watchlist',
    'showId',
    '(SELECT isAdult FROM shows_meta WHERE id = p.showId) = 1'
  )

  assert.deepEqual(ids, ['a'])
})
