import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterMedia, startDateRank } from './media-filter.js'
import type { AnilistMedia } from './anilist.js'

const media = (over: Partial<AnilistMedia>): AnilistMedia => ({
  id: 1,
  idMal: null,
  ...over,
})

test('filterMedia keeps only the excluded genres out', () => {
  const list = [media({ id: 1, genres: ['Action', 'Comedy'] }), media({ id: 2, genres: ['Drama'] })]
  assert.deepEqual(
    filterMedia(list, { genre_not_in: ['comedy'] }).map((m) => m.id),
    [2]
  )
})

test('filterMedia applies the format, episode and score filters', () => {
  const list = [
    media({ id: 1, format: 'TV', episodes: 12, averageScore: 80 }),
    media({ id: 2, format: 'MOVIE', episodes: 1, averageScore: 20 }),
  ]
  assert.deepEqual(
    filterMedia(list, { format: 'tv', episodes_greater: 1, averageScore_greater: 50 }).map(
      (m) => m.id
    ),
    [1]
  )
})

test('filterMedia filters the season only without a query', () => {
  const list = [media({ id: 1, startDate: { year: 2024, month: 5 } })]
  assert.equal(filterMedia(list, { season: 'SPRING', seasonYear: 2024 }).length, 1)
  assert.equal(filterMedia(list, { season: 'SUMMER', seasonYear: 2024 }).length, 0)
  // a query search keeps the season out of the filter
  assert.equal(filterMedia(list, { season: 'SUMMER', seasonYear: 2024, hasQuery: true }).length, 1)
})

test('filterMedia sorts by score and episodes when asked', () => {
  const list = [
    media({ id: 1, averageScore: 50, episodes: 24 }),
    media({ id: 2, averageScore: 90, episodes: 12 }),
  ]
  assert.deepEqual(
    filterMedia(list, { sort: 'SCORE_DESC' }).map((m) => m.id),
    [2, 1]
  )
  assert.deepEqual(
    filterMedia(list, { sort: 'EPISODES_ASC' }).map((m) => m.id),
    [2, 1]
  )
})

test('filterMedia keeps the adult flag strict', () => {
  const list = [media({ id: 1, isAdult: true }), media({ id: 2, isAdult: false })]
  assert.deepEqual(
    filterMedia(list, { isAdult: true }).map((m) => m.id),
    [1]
  )
  assert.deepEqual(
    filterMedia(list, { isAdult: false }).map((m) => m.id),
    [2]
  )
})

test('startDateRank sorts by year, month and day', () => {
  assert.ok(
    startDateRank(media({ startDate: { year: 2024, month: 5, day: 2 } })) >
      startDateRank(media({ startDate: { year: 2024, month: 4, day: 28 } }))
  )
  assert.equal(startDateRank(media({})), 0)
})
