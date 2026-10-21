import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { DatabaseWrapper } from '../db.js'
import { ShowsMetaRepository } from './shows-meta.repository.js'
import { createTestDb } from '../test-helpers.js'

let db: DatabaseWrapper
let cleanup: () => void

beforeEach(async () => {
  const t = await createTestDb()
  db = t.db
  cleanup = t.cleanup
})

afterEach(() => cleanup())

test('getAdultIds returns only the adult ids', async () => {
  db.run(`INSERT INTO shows_meta (id,name,isAdult) VALUES ('a','a',1)`)
  db.run(`INSERT INTO shows_meta (id,name,isAdult) VALUES ('b','b',0)`)
  db.run(`INSERT INTO shows_meta (id,name,isAdult) VALUES ('c','c',1)`)

  const ids = await ShowsMetaRepository.getAdultIds(db, ['a', 'b', 'c'])

  assert.deepEqual(ids.sort(), ['a', 'c'])
})

test('getAdultIds handles an empty list without touching the db', async () => {
  assert.deepEqual(await ShowsMetaRepository.getAdultIds(db, []), [])
})

test('getGenresById parses the stored genre json', async () => {
  db.run(`INSERT INTO shows_meta (id,name,genres) VALUES ('a','a','["Action","Drama"]')`)
  db.run(`INSERT INTO shows_meta (id,name,genres) VALUES ('b','b',NULL)`)

  const genres = await ShowsMetaRepository.getGenresById(db, ['a', 'b'])

  assert.deepEqual(genres.get('a'), ['Action', 'Drama'])
  assert.deepEqual(genres.get('b'), [])
})

test('getAnilistId returns null when there is no anilist id', async () => {
  db.run(`INSERT INTO shows_meta (id,name,anilistId) VALUES ('a','a',NULL)`)
  db.run(`INSERT INTO shows_meta (id,name,anilistId) VALUES ('b','b',99)`)

  assert.equal(await ShowsMetaRepository.getAnilistId(db, 'a'), null)
  assert.equal(await ShowsMetaRepository.getAnilistId(db, 'b'), 99)
  assert.equal(await ShowsMetaRepository.getAnilistId(db, 'missing'), null)
})

test('backfillNamesFromWatchlist fills an empty meta name from the watchlist', async () => {
  db.run(`INSERT INTO watchlist (id,name,thumbnail,status) VALUES ('a','Real Name','t','Watching')`)
  db.run(`INSERT INTO shows_meta (id,name) VALUES ('a','')`)
  db.run(`INSERT INTO shows_meta (id,name) VALUES ('b',NULL)`)
  db.run(`INSERT INTO shows_meta (id,name) VALUES ('c','Already Set')`)

  await ShowsMetaRepository.backfillNamesFromWatchlist(db)

  assert.equal(
    db.get<{ name: string }>('SELECT name FROM shows_meta WHERE id=?', ['a'])?.name,
    'Real Name'
  )
  assert.equal(
    db.get<{ name: string }>('SELECT name FROM shows_meta WHERE id=?', ['b'])?.name,
    null
  )
  assert.equal(
    db.get<{ name: string }>('SELECT name FROM shows_meta WHERE id=?', ['c'])?.name,
    'Already Set'
  )
})
