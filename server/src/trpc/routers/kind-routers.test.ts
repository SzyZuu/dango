import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDbs } from '../../test-helpers.js'
import { AppCache } from '../../utils/cache.utils.js'
import type { TrpcContext } from '../context.js'
import { tvLibraryRouter } from './tv-library.js'
import { asmrLibraryRouter } from './asmr-library.js'
import { mangaLibraryRouter } from './manga-library.js'
import { tvProgressRouter } from './tv-progress.js'
import { asmrProgressRouter } from './asmr-progress.js'
import { mangaProgressRouter } from './manga-progress.js'

async function makeContext() {
  const dbs = await createTestDbs()
  const ctx: TrpcContext = {
    ...dbs,
    apiCache: new AppCache(),
    getTvProvider: () => undefined,
    getMangaProvider: () => undefined,
    getJasmr: () => undefined,
    getProviders: () => ({}),
    getCatalog: () => [],
    lanAuthed: true,
  }
  return { ctx, cleanup: dbs.cleanup }
}

test('the tv library router adds, lists, checks and removes', async () => {
  const { ctx, cleanup } = await makeContext()
  try {
    const caller = tvLibraryRouter.createCaller(ctx)
    const added = await caller.add({ tmdbId: 42, mediaType: 'tv', title: 'Show', poster: 'p.jpg' })
    assert.equal(added.id, 'tv:42')

    const list = await caller.list({ page: 1, limit: 24 })
    assert.equal(list.total, 1)
    assert.equal(list.data[0].title, 'Show')

    const check = await caller.check({ id: 'tv:42' })
    assert.equal(check.inLibrary, true)
    assert.equal(check.status, 'Watching')

    await caller.setStatus({ id: 'tv:42', status: 'Completed' })
    assert.equal((await caller.check({ id: 'tv:42' })).status, 'Completed')

    const ids = await caller.ids()
    assert.deepEqual(ids.ids, ['tv:42'])

    await caller.remove('tv:42')
    assert.equal((await caller.list({ page: 1, limit: 24 })).total, 0)
  } finally {
    cleanup()
  }
})

test('the asmr library router adds and removes with the { ids } removeMany shape', async () => {
  const { ctx, cleanup } = await makeContext()
  try {
    const caller = asmrLibraryRouter.createCaller(ctx)
    const added = await caller.add({ rjCode: 'RJ123', title: 'Work', thumbnail: 't.jpg' })
    assert.equal(added.id, 'RJ123')

    await caller.add({ rjCode: 'RJ456', title: 'Other', thumbnail: 'o.jpg' })
    const list = await caller.list({ page: 1, limit: 24 })
    assert.equal(list.total, 2)

    await caller.remove({ id: 'RJ123' })
    assert.equal((await caller.list({ page: 1, limit: 24 })).total, 1)

    await caller.removeMany({ ids: ['RJ456'] })
    assert.equal((await caller.list({ page: 1, limit: 24 })).total, 0)
  } finally {
    cleanup()
  }
})

test('the manga library router keeps its manga-only entry and link procedures', async () => {
  const { ctx, cleanup } = await makeContext()
  try {
    const caller = mangaLibraryRouter.createCaller(ctx)
    const added = await caller.add({ provider: 'mangadex', mangaId: '99', title: 'Manga' })
    assert.equal(added.id, 'mangadex:99')

    const entry = await caller.entry({ id: 'mangadex:99' })
    assert.equal(entry.item.title, 'Manga')

    const linked = await caller.link({ id: 'mangadex:99', anilistId: 4242 })
    assert.equal(linked.success, true)
    assert.equal(linked.progressMigrated, false)
  } finally {
    cleanup()
  }
})

test('the tv progress router saves, reads back and removes one episode', async () => {
  const { ctx, cleanup } = await makeContext()
  try {
    const caller = tvProgressRouter.createCaller(ctx)
    await caller.save({ mediaId: 'tv:7', season: 1, episode: 2, currentTime: 10, duration: 100 })
    await caller.save({ mediaId: 'tv:7', season: 1, episode: 3, currentTime: 20, duration: 100 })

    const all = await caller.getByMedia({ mediaId: 'tv:7' })
    assert.equal(all.progress.length, 2)

    const latest = await caller.latest({ mediaId: 'tv:7' })
    assert.equal(latest.currentTime, 20)

    const one = await caller.latest({ mediaId: 'tv:7', season: 1, episode: 2 })
    assert.equal(one.currentTime, 10)

    await caller.remove({ mediaId: 'tv:7', season: 1, episode: 2 })
    assert.equal((await caller.getByMedia({ mediaId: 'tv:7' })).progress.length, 1)

    await caller.remove({ mediaId: 'tv:7' })
    assert.equal((await caller.getByMedia({ mediaId: 'tv:7' })).progress.length, 0)
  } finally {
    cleanup()
  }
})

test('the manga progress router saves a chapter and removes just that chapter', async () => {
  const { ctx, cleanup } = await makeContext()
  try {
    const caller = mangaProgressRouter.createCaller(ctx)
    await caller.save({ mangaId: 'mangadex:1', chapterId: 'ch1', chapterNumber: '1', page: 3 })
    await caller.save({ mangaId: 'mangadex:1', chapterId: 'ch2', chapterNumber: '2', page: 1 })

    const all = await caller.byManga({ mangaId: 'mangadex:1' })
    assert.equal(all.progress.length, 2)

    await caller.remove({ mangaId: 'mangadex:1', chapterId: 'ch1' })
    const left = await caller.byManga({ mangaId: 'mangadex:1' })
    assert.equal(left.progress.length, 1)
    assert.equal(left.progress[0].chapterId, 'ch2')
  } finally {
    cleanup()
  }
})

test('the asmr progress router saves a track and continues from it', async () => {
  const { ctx, cleanup } = await makeContext()
  try {
    const caller = asmrProgressRouter.createCaller(ctx)
    await caller.save({
      workId: 'RJ9',
      trackIndex: 0,
      trackLabel: 'Intro',
      currentTime: 5,
      duration: 60,
    })

    const all = await caller.getByWork({ workId: 'RJ9' })
    assert.equal(all.progress.length, 1)
    assert.equal(all.progress[0].trackLabel, 'Intro')

    const list = await caller.continueListening({ limit: 24 })
    assert.equal(list.total, 1)
    assert.equal(list.data[0].id, 'RJ9')
  } finally {
    cleanup()
  }
})
