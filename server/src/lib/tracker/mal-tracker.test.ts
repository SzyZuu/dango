import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.XDG_DATA_HOME = mkdtempSync(path.join(tmpdir(), 'dango-tracker-test-'))
const { initializeDatabase } = await import('../../db/ddl.js')
const { SettingsRepository: settings } = await import('../../repositories/settings.repository.js')
const { WatchedEpisodesRepository: watched } =
  await import('../../repositories/watched-episodes.repository.js')
const { MAL_KEYS, beginMalLogin, finishMalLogin, MalTracker } =
  await import('../../lib/tracker/mal-tracker.js')
const { queueEpisodeSync, flushEpisodeSync, completedProgress, trackerUpdateStatus } =
  await import('../../lib/tracker/episode-sync.js')
const { syncMyAnimeList } = await import('../../lib/tracker/mal-sync.service.js')
const { trackerRouter } = await import('../../trpc/routers/tracker.js')
const { progressRouter } = await import('../../trpc/routers/progress.js')
const { settingsRouter } = await import('../../trpc/routers/settings.js')
const { exportTables, importTables } = await import('../../sync-payload.js')
import type { TrpcContext } from '../../trpc/context.js'

async function database(t: TestContext) {
  const db = await initializeDatabase(':memory:')
  t.after(() => db.close(() => {}))
  return db
}
function mockFetch(
  t: TestContext,
  fn: (url: string, init: RequestInit) => Response | Promise<Response>
) {
  const original = globalThis.fetch
  globalThis.fetch = (async (url, init = {}) => fn(String(url), init)) as typeof fetch
  t.after(() => {
    globalThis.fetch = original
  })
}
const json = (body: unknown, status = 200) => Response.json(body, { status })
async function connect(db: Awaited<ReturnType<typeof database>>, expiresAt = Date.now() + 3600000) {
  await settings.upsert(db, MAL_KEYS.clientId, 'test-client')
  await settings.upsert(
    db,
    MAL_KEYS.tokens,
    JSON.stringify({ access_token: 'test-access', refresh_token: 'test-refresh', expiresAt })
  )
}
function context(db: Awaited<ReturnType<typeof database>>) {
  return { db, lanAuthed: true, discordRPC: { updatePresence() {} } } as unknown as TrpcContext
}

await test('MAL login uses PKCE, verifies state, and consumes callback once', async (t) => {
  const db = await database(t)
  await settings.upsert(db, MAL_KEYS.clientId, 'test-client')
  const login = await beginMalLogin(db, 'http://localhost:5174/trackers')
  const url = new URL(login.url)
  assert.equal(url.searchParams.get('code_challenge_method'), 'plain')
  assert.equal(url.searchParams.get('code_challenge')?.length, 128)
  await assert.rejects(finishMalLogin(db, 'test-code', 'mal:wrong'), /invalid state/)
  mockFetch(t, (url, init) => {
    if (url.endsWith('/token')) {
      const body = init.body as URLSearchParams
      assert.equal(body.get('code_verifier'), new URL(login.url).searchParams.get('code_challenge'))
      assert.equal(body.get('redirect_uri'), 'http://localhost:5174/trackers')
      return json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 })
    }
    return json({ id: 1, name: 'Test viewer' })
  })
  assert.equal((await finishMalLogin(db, 'test-code', login.state)).name, 'Test viewer')
  await assert.rejects(finishMalLogin(db, 'test-code', login.state), /expired/)
  const status = await trackerRouter.createCaller(context(db)).status()
  assert.equal(status.mal.connected, true)
  assert.equal(JSON.stringify(status).includes('test-access'), false)
})

await test('MAL rejects expired states and unsupported callback URLs', async (t) => {
  const db = await database(t)
  await settings.upsert(db, MAL_KEYS.clientId, 'test-client')
  await assert.rejects(beginMalLogin(db, 'https://example.com/other'), /Trackers/)
  const login = await beginMalLogin(db, 'http://localhost:3000/trackers')
  const pending = JSON.parse((await settings.getByKey(db, MAL_KEYS.pending))!.value)
  pending.expiresAt = 1
  await settings.upsert(db, MAL_KEYS.pending, JSON.stringify(pending))
  await assert.rejects(finishMalLogin(db, 'test-code', login.state), /expired/)
})

await test('concurrent MAL requests refresh expiring tokens only once', async (t) => {
  const db = await database(t)
  await connect(db, 0)
  let refreshes = 0
  mockFetch(t, async (url, init) => {
    if (url.endsWith('/token')) {
      refreshes++
      assert.equal((init.body as URLSearchParams).get('grant_type'), 'refresh_token')
      await new Promise((r) => setTimeout(r, 10))
      return json({ access_token: 'test-new', refresh_token: 'test-rotated', expires_in: 3600 })
    }
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer test-new')
    return json({ id: 1, title: 'Example' })
  })
  await Promise.all([new MalTracker(db).getAnime(1), new MalTracker(db).getAnime(2)])
  assert.equal(refreshes, 1)
  assert.equal(
    JSON.parse((await settings.getByKey(db, MAL_KEYS.tokens))!.value).refresh_token,
    'test-rotated'
  )
})

await test('MAL 401 refreshes and retries the request', async (t) => {
  const db = await database(t)
  await connect(db)
  let calls = 0
  mockFetch(t, (url) => {
    if (url.endsWith('/token'))
      return json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 })
    return ++calls === 1 ? json({}, 401) : json({ id: 1, title: 'Example' })
  })
  assert.equal((await new MalTracker(db).getAnime(1)).id, 1)
  assert.equal(calls, 2)
})

await test('episode completion updates both trackers, skips partial/special episodes, and deduplicates ticks', async (t) => {
  const db = await database(t)
  await connect(db)
  await settings.upsert(db, 'tracker_anilist_token', 'test-anilist')
  await settings.upsert(db, 'tracker_mal_link_101', '1')
  db.run(
    "INSERT INTO shows_meta (id, anilistId, name, episodeCount) VALUES ('101',101,'Example',2)"
  )
  const writes: { provider: string; progress: number; status: string }[] = []
  mockFetch(t, (url, init) => {
    if (url.includes('graphql.anilist')) {
      const body = JSON.parse(String(init.body))
      if (body.query.includes('SaveMediaListEntry')) {
        writes.push({
          provider: 'anilist',
          progress: body.variables.progress,
          status: body.variables.status,
        })
        return json({ data: {} })
      }
      return json({ data: { Media: { episodes: 2, mediaListEntry: { progress: 0 } } } })
    }
    if (init.method === 'PUT') {
      const body = init.body as URLSearchParams
      writes.push({
        provider: 'mal',
        progress: Number(body.get('num_watched_episodes')),
        status: body.get('status')!,
      })
      return json({})
    }
    return json({ id: 1, num_episodes: 2, my_list_status: { num_episodes_watched: 0 } })
  })
  const caller = progressRouter.createCaller(context(db))
  await caller.updateProgress({ showId: '101', episodeNumber: '1', currentTime: 79, duration: 100 })
  await flushEpisodeSync(db)
  assert.equal(writes.length, 0)
  await caller.updateProgress({ showId: '101', episodeNumber: '1', currentTime: 80, duration: 100 })
  await flushEpisodeSync(db)
  assert.equal(writes.length, 2)
  assert.ok(writes.some((w) => w.provider === 'mal' && w.status === 'watching' && w.progress === 1))
  await caller.updateProgress({ showId: '101', episodeNumber: '1', currentTime: 90, duration: 100 })
  await flushEpisodeSync(db)
  assert.equal(writes.length, 2)
  await caller.updateProgress({
    showId: '101',
    episodeNumber: '1.5',
    currentTime: 100,
    duration: 100,
  })
  await flushEpisodeSync(db)
  assert.equal(writes.length, 2)
  await caller.updateProgress({
    showId: '101',
    episodeNumber: '2',
    currentTime: 100,
    duration: 100,
  })
  await flushEpisodeSync(db)
  assert.equal(writes.length, 4)
  assert.ok(
    writes.some((w) => w.provider === 'anilist' && w.progress === 2 && w.status === 'COMPLETED')
  )
  assert.ok(
    writes.some((w) => w.provider === 'mal' && w.progress === 2 && w.status === 'completed')
  )
})

await test('a MAL outage keeps durable pending progress while AniList succeeds, then retries', async (t) => {
  const db = await database(t)
  await connect(db)
  await settings.upsert(db, 'tracker_anilist_token', 'test-anilist')
  await settings.upsert(db, 'tracker_mal_link_101', '1')
  db.run("INSERT INTO shows_meta (id, anilistId, episodeCount) VALUES ('101',101,12)")
  await watched.upsert(db, { showId: '101', episodeNumber: '1', currentTime: 100, duration: 100 })
  let failing = true,
    malWrites = 0
  mockFetch(t, (url, init) => {
    if (url.includes('graphql.anilist'))
      return json({ data: { Media: { episodes: 12, mediaListEntry: { progress: 0 } } } })
    if (failing) return json({}, 503)
    if (init.method === 'PUT') {
      malWrites++
      return json({})
    }
    return json({ id: 1, num_episodes: 12, my_list_status: { num_episodes_watched: 3 } })
  })
  await queueEpisodeSync(db, '101')
  await flushEpisodeSync(db)
  assert.equal(trackerUpdateStatus(db, 'anilist').pending, 0)
  assert.equal(trackerUpdateStatus(db, 'mal').pending, 1)
  assert.ok(trackerUpdateStatus(db, 'mal').error)
  failing = false
  await flushEpisodeSync(db, true)
  assert.equal(malWrites, 1)
  assert.equal(trackerUpdateStatus(db, 'mal').pending, 0)
})

await test('in-flight completion cannot acknowledge a newer queued episode', async (t) => {
  const db = await database(t)
  await connect(db)
  await settings.upsert(db, 'tracker_mal_link_101', '1')
  db.run("INSERT INTO shows_meta (id, anilistId, episodeCount) VALUES ('101',101,12)")
  await watched.insertIfMissing(db, { showId: '101', episodeNumber: '1' })
  await queueEpisodeSync(db, '101')
  mockFetch(t, async (_url, init) => {
    if (init.method === 'PUT') {
      await watched.insertIfMissing(db, { showId: '101', episodeNumber: '2' })
      await queueEpisodeSync(db, '101')
      return json({})
    }
    return json({ id: 1, num_episodes: 12 })
  })
  await flushEpisodeSync(db)
  assert.equal(trackerUpdateStatus(db, 'mal').pending, 1)
  assert.equal(db.get<{ progress: number }>('SELECT progress FROM tracker_updates')?.progress, 2)
})

await test('MAL two-way sync paginates, pulls and pushes progress, and never deletes absent entries', async (t) => {
  const db = await database(t)
  await connect(db)
  db.run(
    "INSERT INTO watchlist (id,name,status) VALUES ('mal-1','Local','Watching'), ('mal-3','Local only','Planned')"
  )
  await watched.insertIfMissing(db, { showId: 'mal-1', episodeNumber: '3' })
  let pages = 0
  const writes: number[] = []
  mockFetch(t, (url, init) => {
    if (url.includes('/animelist?')) {
      pages++
      return pages === 1
        ? json({
            data: [
              {
                node: { id: 1, title: 'Local', num_episodes: 12 },
                list_status: { status: 'watching', num_episodes_watched: 1 },
              },
            ],
            paging: { next: 'https://untrusted.example/never-follow' },
          })
        : json({
            data: [
              {
                node: { id: 2, title: 'Remote only', num_episodes: 12 },
                list_status: { status: 'completed', num_episodes_watched: 12 },
              },
            ],
          })
    }
    assert.equal(init.method, 'PUT')
    writes.push(Number((init.body as URLSearchParams).get('num_watched_episodes')))
    return json({})
  })
  const result = await syncMyAnimeList(db)
  assert.equal(pages, 2)
  assert.equal(result.pulled, 1)
  assert.equal(result.merged, 1)
  assert.equal(result.pushed, 1)
  assert.ok(writes.includes(3))
  assert.equal(await completedProgress(db, 'mal-2'), 12)
  assert.equal(db.all('SELECT * FROM watchlist').length, 3)
})

await test('MAL secrets stay out of generic settings, status, and library exports; imports preserve local account', async (t) => {
  const db = await database(t)
  await connect(db)
  await settings.upsert(db, MAL_KEYS.clientSecret, 'test-private-secret')
  await assert.rejects(
    settingsRouter.createCaller(context(db)).getByKey({ key: MAL_KEYS.clientSecret }),
    /private/
  )
  const payload = exportTables(db, ['settings'] as const)
  assert.equal(JSON.stringify(payload).includes('test-private-secret'), false)
  assert.equal(JSON.stringify(payload).includes('test-access'), false)
  importTables(
    db,
    ['settings'],
    {
      version: 1,
      exportedAt: '',
      tables: {
        settings: [
          { key: MAL_KEYS.tokens, value: 'foreign-tokens' },
          { key: 'theme', value: 'dark' },
        ],
      },
    },
    { libraryTables: ['settings'], backupName: 'test-before-import.db' }
  )
  assert.equal(
    JSON.parse((await settings.getByKey(db, MAL_KEYS.tokens))!.value).access_token,
    'test-access'
  )
  await trackerRouter.createCaller(context(db)).malDisconnect()
  assert.equal((await trackerRouter.createCaller(context(db)).status()).mal.connected, false)
  assert.equal((await settings.getByKey(db, MAL_KEYS.clientId))?.value, 'test-client')
})

await test('pending episode updates survive a database close and reopen', async (t) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'dango-pending-')), 'anime.db')
  const first = await initializeDatabase(file)
  await connect(first)
  await settings.upsert(first, 'tracker_mal_link_101', '1')
  first.run("INSERT INTO shows_meta (id, anilistId, episodeCount) VALUES ('101',101,12)")
  await watched.insertIfMissing(first, { showId: '101', episodeNumber: '4' })
  await queueEpisodeSync(first, '101')
  await new Promise<void>((resolve) => first.close(() => resolve()))
  const reopened = await initializeDatabase(file)
  t.after(() => reopened.close(() => {}))
  assert.equal(trackerUpdateStatus(reopened, 'mal').pending, 1)
  mockFetch(t, (_url, init) => {
    if (init.method === 'PUT') {
      assert.equal((init.body as URLSearchParams).get('num_watched_episodes'), '4')
      return json({})
    }
    return json({ id: 1, num_episodes: 12 })
  })
  await flushEpisodeSync(reopened)
  assert.equal(trackerUpdateStatus(reopened, 'mal').pending, 0)
})

await test('remote MAL progress completes a partial local playback record', async (t) => {
  const db = await database(t)
  await connect(db)
  db.run("INSERT INTO watchlist (id,name,status) VALUES ('mal-1','Example','Watching')")
  await watched.upsert(db, { showId: 'mal-1', episodeNumber: '1', currentTime: 20, duration: 100 })
  mockFetch(t, () =>
    json({
      data: [
        {
          node: { id: 1, title: 'Example', num_episodes: 12 },
          list_status: { status: 'watching', num_episodes_watched: 2 },
        },
      ],
    })
  )
  await syncMyAnimeList(db)
  assert.equal(await completedProgress(db, 'mal-1'), 2)
  assert.equal((await watched.getByShowAndEpisode(db, 'mal-1', '1'))?.currentTime, 100)
})

await test('MAL sync does not retry a failed merge as a lower-progress local-only push', async (t) => {
  const db = await database(t)
  await connect(db)
  db.run("INSERT INTO watchlist (id,name,status) VALUES ('mal-1','Example','Watching')")
  await watched.insertIfMissing(db, { showId: 'mal-1', episodeNumber: '1' })
  let writes = 0
  mockFetch(t, (_url, init) => {
    if (init.method === 'PUT') {
      writes++
      return json({}, 503)
    }
    return json({
      data: [
        {
          node: { id: 1, title: 'Example', num_episodes: 12 },
          list_status: { status: 'on_hold', num_episodes_watched: 5 },
        },
      ],
    })
  })
  const result = await syncMyAnimeList(db)
  assert.equal(result.errors.length, 1)
  assert.equal(writes, 1)
})

await test('manual list status updates sync and later playback ticks do not undo them', async (t) => {
  const db = await database(t)
  await connect(db)
  await settings.upsert(db, 'tracker_mal_link_101', '1')
  db.run("INSERT INTO shows_meta (id, anilistId, episodeCount) VALUES ('101',101,12)")
  db.run("INSERT INTO watchlist (id, name, status) VALUES ('101','Example','Watching')")
  const writes: string[] = []
  mockFetch(t, (_url, init) => {
    if (init.method === 'PUT') {
      writes.push((init.body as URLSearchParams).get('status')!)
      return json({})
    }
    return json({ id: 1, num_episodes: 12, my_list_status: { num_episodes_watched: 1 } })
  })
  const progress = progressRouter.createCaller(context(db))
  await progress.updateProgress({
    showId: '101',
    episodeNumber: '1',
    currentTime: 80,
    duration: 100,
  })
  await flushEpisodeSync(db)
  const { watchlistRouter } = await import('../../trpc/routers/watchlist.js')
  await watchlistRouter.createCaller(context(db)).setStatus({ id: '101', status: 'On-Hold' })
  await flushEpisodeSync(db)
  assert.deepEqual(writes, ['watching', 'on_hold'])
  await progress.updateProgress({
    showId: '101',
    episodeNumber: '1',
    currentTime: 90,
    duration: 100,
  })
  await flushEpisodeSync(db)
  assert.equal(writes.length, 2)
})
