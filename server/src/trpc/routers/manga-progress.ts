import { router, protectedProcedure } from '../index.js'
import { performMangaWriteTransactionAsync } from '../../db/transaction.js'
import { adultNonListIds } from '../../utils/db-utils.js'
import type { DatabaseWrapper } from '../../db.js'
import {
  MangaLibraryRepository,
  MangaProgressRepository,
  type MangaContinueReadingRow,
  type MangaProgressRow,
} from '../../repositories/manga.repository.js'
import { createProgressRouter } from './progress-factory.js'
import { defineSchema, idFieldInput, optStr, reqObj, reqStr } from '../validation.js'

const MANGA_ADULT_RATINGS = ['erotica', 'pornographic']

const getAdultNonListMangaIds = (db: DatabaseWrapper) =>
  adultNonListIds(
    db,
    'manga_progress',
    'manga_library',
    'mangaId',
    "COALESCE(l.contentRating, p.contentRating) IN ('erotica', 'pornographic')"
  )

export type MangaIdInput = { mangaId: string }

const mangaIdInput = () => idFieldInput('mangaId')

export type MangaProgressSaveInput = {
  mangaId: string
  chapterId: string
  chapterNumber?: string
  page?: number
  pageCount?: number
  title?: string | null
  cover?: string | null
  provider?: string | null
  altTitle?: string | null
  contentRating?: string | null
}

const mangaProgressSaveInput = () =>
  defineSchema<MangaProgressSaveInput, MangaProgressSaveInput>((value) => {
    const obj = reqObj(value)
    const out: MangaProgressSaveInput = {
      mangaId: reqStr(obj, 'mangaId'),
      chapterId: reqStr(obj, 'chapterId'),
    }
    if (obj.chapterNumber !== undefined && obj.chapterNumber !== null)
      out.chapterNumber = String(obj.chapterNumber)
    if (obj.page !== undefined && obj.page !== null) {
      const page = Number(obj.page)
      if (!Number.isNaN(page)) out.page = page
    }
    if (obj.pageCount !== undefined && obj.pageCount !== null) {
      const pageCount = Number(obj.pageCount)
      if (!Number.isNaN(pageCount)) out.pageCount = pageCount
    }
    const title = optStr(obj, 'title')
    if (title !== undefined) out.title = title
    const cover = optStr(obj, 'cover')
    if (cover !== undefined) out.cover = cover
    const provider = optStr(obj, 'provider')
    if (provider !== undefined) out.provider = provider
    const altTitle = optStr(obj, 'altTitle')
    if (altTitle !== undefined) out.altTitle = altTitle
    const contentRating = optStr(obj, 'contentRating')
    if (contentRating !== undefined) out.contentRating = contentRating
    return out
  })

export type MangaProgressRemoveInput = { mangaId: string; chapterId?: string }

const mangaProgressRemoveInput = () =>
  defineSchema<MangaProgressRemoveInput, MangaProgressRemoveInput>((value) => {
    const obj = reqObj(value)
    const out: MangaProgressRemoveInput = { mangaId: reqStr(obj, 'mangaId') }
    const chapterId = optStr(obj, 'chapterId')
    if (chapterId !== undefined) out.chapterId = chapterId
    return out
  })

const shared = createProgressRouter<
  MangaProgressRow,
  MangaContinueReadingRow,
  MangaIdInput,
  MangaProgressRemoveInput
>({
  db: (ctx) => ctx.mangaDb,
  write: performMangaWriteTransactionAsync,
  repo: MangaProgressRepository,
  keyField: 'mangaId',
  byKeyInput: mangaIdInput(),
  removeInput: mangaProgressRemoveInput(),
  removeOne: (db, key, input) => {
    if (!input.chapterId) return false
    MangaProgressRepository.deleteChapter(db, key, input.chapterId)
    return true
  },
  continueRows: (db, limit) => MangaProgressRepository.getContinueReading(db, limit),
  continueSettings: { ignoreAdult: 'mangaIgnoreAdultContent', listOnly: 'mangaCwWatchlistOnly' },
  isAdult: (row) => !!row.contentRating && MANGA_ADULT_RATINGS.includes(row.contentRating),
  watchlistStatus: 'Reading',
  adultIds: getAdultNonListMangaIds,
})

export const mangaProgressRouter = router({
  byManga: shared.byKey,

  save: protectedProcedure.input(mangaProgressSaveInput()).mutation(async ({ ctx, input }) => {
    const pageNum = Math.max(Number(input.page) || 0, 0)
    const pageCountNum = Math.max(Number(input.pageCount) || 0, 0)
    await performMangaWriteTransactionAsync(ctx.mangaDb, async (tx) => {
      await MangaProgressRepository.upsert(tx, {
        mangaId: String(input.mangaId),
        chapterId: String(input.chapterId),
        chapterNumber: String(input.chapterNumber || ''),
        page: pageNum,
        pageCount: pageCountNum,
        title: input.title ?? null,
        cover: input.cover ?? null,
        provider: input.provider ?? null,
        altTitle: input.altTitle ?? null,
        contentRating: input.contentRating ?? null,
      })
      await MangaLibraryRepository.touchProgress(tx, String(input.mangaId), {
        chapterId: String(input.chapterId),
        chapterNumber: String(input.chapterNumber || ''),
        page: pageNum,
      })
    })
    return { success: true }
  }),

  remove: shared.remove,
  removeMany: shared.removeMany,
  continueReading: shared.continue,
  adultCount: shared.adultCount,
  purgeAdult: shared.purgeAdult,
})
