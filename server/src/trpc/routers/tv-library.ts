import { router } from '../index.js'
import { performTvWriteTransactionAsync } from '../../db/transaction.js'
import {
  buildTvId,
  TV_STATUSES,
  TvLibraryRepository,
  TvProgressRepository,
} from '../../repositories/tv.repository.js'
import { createLibraryRouter } from './library-factory.js'
import { badRequest, defineSchema, reqObj } from '../validation.js'

function normalizeMediaType(raw: unknown): 'movie' | 'tv' {
  return String(raw).toLowerCase() === 'movie' ? 'movie' : 'tv'
}

export type TvLibraryAddInput = {
  tmdbId?: unknown
  mediaType?: unknown
  id?: unknown
  title?: unknown
  poster?: unknown
  backdrop?: unknown
  year?: unknown
  overview?: unknown
  status?: unknown
  adult?: unknown
}

const tvLibraryAddInput = () =>
  defineSchema<TvLibraryAddInput, TvLibraryAddInput>((value) => {
    const obj = reqObj(value)
    return {
      tmdbId: obj.tmdbId,
      mediaType: obj.mediaType,
      id: obj.id,
      title: obj.title,
      poster: obj.poster,
      backdrop: obj.backdrop,
      year: obj.year,
      overview: obj.overview,
      status: obj.status,
      adult: obj.adult,
    }
  })

export const tvLibraryRouter = router(
  createLibraryRouter({
    db: (ctx) => ctx.tvDb,
    write: performTvWriteTransactionAsync,
    repo: TvLibraryRepository,
    progress: {
      deleteByKey: (db, id) => TvProgressRepository.deleteByKey(db, id),
      deleteMany: (db, ids) => TvProgressRepository.deleteMany(db, ids),
    },
    statuses: TV_STATUSES,
    defaultStatus: 'Watching',
    add: {
      input: tvLibraryAddInput(),
      build: (input, status) => {
        const tmdbIdNum = Number(input.tmdbId)
        if (!tmdbIdNum || (!input.id && !input.mediaType)) {
          throw badRequest('tmdbId and mediaType are required')
        }
        const mediaType = normalizeMediaType(
          input.mediaType || (String(input.id).startsWith('movie:') ? 'movie' : 'tv')
        )
        const id =
          input.id && String(input.id).includes(':')
            ? String(input.id)
            : buildTvId(mediaType, tmdbIdNum)
        return {
          id,
          row: {
            id,
            tmdbId: tmdbIdNum,
            mediaType,
            title: String(input.title || ''),
            poster: String(input.poster || ''),
            backdrop: input.backdrop ? String(input.backdrop) : undefined,
            year: input.year ? String(input.year) : undefined,
            overview: input.overview ? String(input.overview) : undefined,
            status,
            adult: input.adult === true,
          },
        }
      },
    },
  })
)
