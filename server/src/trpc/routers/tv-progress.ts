import { router, protectedProcedure } from '../index.js'
import { performTvWriteTransactionAsync } from '../../db/transaction.js'
import { adultNonListIds } from '../../utils/db-utils.js'
import type { DatabaseWrapper } from '../../db.js'
import {
  normalizeTvMediaId,
  TvLibraryRepository,
  TvProgressRepository,
  type TvContinueWatchingRow,
  type TvProgressRow,
} from '../../repositories/tv.repository.js'
import { createProgressRouter } from './progress-factory.js'
import { defineSchema, idFieldInput, reqObj, reqStr, strOrNull } from '../validation.js'
import { badRequest } from '../errors.js'

const getAdultNonListMediaIds = (db: DatabaseWrapper) =>
  adultNonListIds(db, 'tv_progress', 'tv_library', 'mediaId', 'COALESCE(l.adult, p.adult) = 1')

export type TvProgressMediaInput = { mediaId: string }

const tvProgressMediaInput = () => idFieldInput('mediaId')

export type TvProgressLatestInput = { mediaId: string; season?: unknown; episode?: unknown }

const tvProgressLatestInput = () =>
  defineSchema<TvProgressLatestInput, TvProgressLatestInput>((value) => {
    const obj = reqObj(value)
    return { mediaId: reqStr(obj, 'mediaId'), season: obj.season, episode: obj.episode }
  })

export type TvProgressSaveInput = {
  mediaId: string
  season?: unknown
  episode?: unknown
  currentTime?: unknown
  duration?: unknown
  completed?: unknown
  title?: string | null
  poster?: string | null
  backdrop?: string | null
  year?: string | null
  overview?: string | null
  tmdbId?: unknown
  mediaType?: string | null
  adult?: unknown
}

const tvProgressSaveInput = () =>
  defineSchema<TvProgressSaveInput, TvProgressSaveInput>((value) => {
    const obj = reqObj(value)
    return {
      mediaId: reqStr(obj, 'mediaId'),
      season: obj.season,
      episode: obj.episode,
      currentTime: obj.currentTime,
      duration: obj.duration,
      completed: obj.completed,
      title: strOrNull(obj, 'title'),
      poster: strOrNull(obj, 'poster'),
      backdrop: strOrNull(obj, 'backdrop'),
      year: strOrNull(obj, 'year'),
      overview: strOrNull(obj, 'overview'),
      tmdbId: obj.tmdbId ?? null,
      mediaType: strOrNull(obj, 'mediaType'),
      adult: obj.adult ?? null,
    }
  })

export type TvProgressRemoveInput = { mediaId: string; season?: unknown; episode?: unknown }

const tvProgressRemoveInput = () =>
  defineSchema<TvProgressRemoveInput, TvProgressRemoveInput>((value) => {
    const obj = reqObj(value)
    return { mediaId: reqStr(obj, 'mediaId'), season: obj.season, episode: obj.episode }
  })

const shared = createProgressRouter<
  TvProgressRow,
  TvContinueWatchingRow,
  TvProgressMediaInput,
  TvProgressRemoveInput
>({
  db: (ctx) => ctx.tvDb,
  write: performTvWriteTransactionAsync,
  repo: TvProgressRepository,
  keyField: 'mediaId',
  byKeyInput: tvProgressMediaInput(),
  removeInput: tvProgressRemoveInput(),
  normalizeKey: normalizeTvMediaId,
  removeOne: (db, key, input) => {
    if (input.season === undefined || input.episode === undefined) return false
    TvProgressRepository.deleteEpisode(db, key, Number(input.season), Number(input.episode))
    return true
  },
  continueRows: (db, limit) => TvProgressRepository.getContinueWatching(db, limit),
  continueSettings: { ignoreAdult: 'tvIgnoreAdultContent', listOnly: 'tvCwWatchlistOnly' },
  isAdult: (row) => row.adult === 1,
  watchlistStatus: 'Watching',
  adultIds: getAdultNonListMediaIds,
})

export const tvProgressRouter = router({
  getByMedia: shared.byKey,

  latest: protectedProcedure.input(tvProgressLatestInput()).query(async ({ ctx, input }) => {
    const mediaId = normalizeTvMediaId(input.mediaId)
    const season = parseInt(String(input.season), 10)
    const episode = parseInt(String(input.episode), 10)
    if (Number.isFinite(season) && Number.isFinite(episode)) {
      const row = await TvProgressRepository.getEpisode(ctx.tvDb, mediaId, season, episode)
      return row || { currentTime: 0, duration: 0, completed: 0 }
    }
    const row = await TvProgressRepository.getLatest(ctx.tvDb, mediaId)
    return row || { currentTime: 0, duration: 0, completed: 0 }
  }),

  save: protectedProcedure.input(tvProgressSaveInput()).mutation(async ({ ctx, input }) => {
    const mediaId = normalizeTvMediaId(input.mediaId)
    if (!mediaId) {
      throw badRequest('mediaId is required')
    }
    const seasonNum = Math.max(Number(input.season) || 1, 1)
    const episodeNum = Math.max(Number(input.episode) || 1, 1)
    const timeNum = Math.max(Number(input.currentTime) || 0, 0)
    const durationNum = Math.max(Number(input.duration) || 0, 0)
    const clampedTime = durationNum > 0 ? Math.min(timeNum, durationNum) : timeNum
    const completedNow =
      Number(input.completed) === 1 || (durationNum > 0 && clampedTime >= durationNum * 0.8) ? 1 : 0
    await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
      await TvProgressRepository.upsert(tx, {
        mediaId: String(mediaId),
        season: Math.round(seasonNum),
        episode: Math.round(episodeNum),
        currentTime: clampedTime,
        duration: durationNum,
        completed: completedNow,
        title: input.title ?? null,
        poster: input.poster ?? null,
        backdrop: input.backdrop ?? null,
        year: input.year ?? null,
        overview: input.overview ?? null,
        tmdbId: input.tmdbId != null ? Number(input.tmdbId) : null,
        mediaType: input.mediaType ?? null,
        adult: input.adult != null ? Number(input.adult) : null,
      })
      await TvLibraryRepository.touchProgress(tx, String(mediaId), {
        season: Math.round(seasonNum),
        episode: Math.round(episodeNum),
      })
    })
    return { success: true }
  }),

  remove: shared.remove,
  removeMany: shared.removeMany,
  continueWatching: shared.continue,
  adultCount: shared.adultCount,
  purgeAdult: shared.purgeAdult,
})
