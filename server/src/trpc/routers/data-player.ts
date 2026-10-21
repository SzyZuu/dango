import { protectedProcedure, router } from '../index.js'
import { fetchWithRetry, parseJsonBody } from '../../utils/http.utils.js'
import { cached } from '../cache.js'
import { authRequiredError } from '../errors.js'
import { ShowsMetaRepository } from '../../repositories/shows-meta.repository.js'
import { WatchlistRepository } from '../../repositories/watchlist.repository.js'
import { LegacyIdMappingRepository } from '../../repositories/legacy-id-mapping.repository.js'
import { TempShowIdsRepository } from '../../repositories/temp-show-ids.repository.js'
import { malCacheStore } from '../../repositories/mal-cache.repository.js'
import { getMigratedId } from '../../lib/migration.js'
import { isTempShowId } from '../../lib/temp-ids.js'
import { pickBestMatch } from '../../providers/title-matching.js'
import { malAnimeDetail } from '../../lib/mal/index.js'
import type { Show } from '../../providers/provider.interface.js'
import logger from '../../logger.js'
import {
  getShowMetaById,
  getAnilistEpisodes,
  parseMalId,
  getShowMetaByMalId,
} from '../../lib/anilist.js'
import {
  dataSkipTimesInput,
  dataEpisodesInput,
  dataShowMetaInput,
  dataVideoInput,
} from '../schemas/data.js'
import {
  getProvider,
  isMatureStreamingProvider,
  resolveMatureStreamingId,
} from '../../lib/resolve-show.js'

const defaultValidate = (d: unknown) => Array.isArray(d) && d.length > 0

export const dataPlayerRouter = router({
  skipTimes: protectedProcedure.input(dataSkipTimesInput()).query(async ({ input }) => {
    try {
      const showId = input.showId || ''
      const episodeNumber = input.episodeNumber || ''
      if (/^\d+$/.test(showId)) {
        const skipRes = await fetchWithRetry(
          `https://api.aniskip.com/v1/skip-times/${showId}/${episodeNumber}?types=op&types=ed`,
          {},
          { timeoutMs: 10000 }
        )
        if (skipRes.ok) {
          return await parseJsonBody(skipRes)
        }
      }
      return { found: false, results: [] }
    } catch {
      return { found: false, results: [] }
    }
  }),

  episodes: protectedProcedure.input(dataEpisodesInput()).query(async ({ ctx, input }) => {
    const showIdParam = input.showId
    return cached(
      ctx,
      `episodes-${showIdParam || ''}`,
      3600,
      async () => {
        const showIdRaw = showIdParam
        if (!showIdRaw) return { episodes: [] }
        const db = ctx.db
        const providers = ctx.getProviders()
        let showId = await getMigratedId(db, showIdRaw)
        const epsMalId = parseMalId(showId)
        if (epsMalId) {
          try {
            const malMeta = await getShowMetaByMalId(epsMalId)
            if (malMeta?.anilistId && malMeta.anilistId > 0) showId = String(malMeta.anilistId)
          } catch {
            // ignore
          }
        }
        if (isTempShowId(showId)) {
          try {
            const row = await TempShowIdsRepository.getById(db, showId)
            if (!row || !isMatureStreamingProvider(ctx, row.provider)) return { episodes: [] }
            const wanted = String(input.provider || '').toLowerCase()
            const own = providers[row.provider]
            if (own && (!wanted || wanted === row.provider)) {
              const data = await own.getEpisodes(row.nativeId, input.mode)
              if (data?.episodes?.length) return data
              return { episodes: [] }
            }
            const hit = await resolveMatureStreamingId(ctx, row.title, wanted)
            if (hit) {
              const data = await hit.provider.getEpisodes(hit.nativeId, input.mode)
              if (data?.episodes?.length) return data
            }
          } catch (e) {
            if ((e as Error).message === 'AUTH_REQUIRED') throw e
          }
          return { episodes: [] }
        }
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(showId)) {
          try {
            if (providers['animepahe']) {
              const data = await providers['animepahe'].getEpisodes(showId, input.mode)
              return data || { episodes: [] }
            }
          } catch (e) {
            if ((e as Error).message === 'AUTH_REQUIRED') throw e
            return { episodes: [] }
          }
        }
        const isNumeric = /^(mal-\d+|-?\d+)$/i.test(showId)
        if (isNumeric) {
          let episodes: string[] = []
          try {
            episodes = await getAnilistEpisodes(showId)
          } catch (e) {
            logger.error({ err: e, showId }, 'Episodes fetch failed')
          }
          if (episodes.length === 0) {
            const absId = Math.abs(parseInt(showId, 10))
            if (!Number.isFinite(absId)) return { episodes }
            try {
              const d = await malAnimeDetail(malCacheStore(), absId)
              const total = d.detail?.episodes
              if (total && total > 0 && total <= 500) {
                episodes = Array.from({ length: total }, (_, i) => (i + 1).toString())
              }
            } catch {
              // ignore
            }
          }
          if (episodes.length === 0) {
            const providerName = input.provider?.toLowerCase()
            const provider = providerName ? providers[providerName] : undefined
            if (provider?.isDirectId?.(showId)) {
              try {
                const data = await provider.getEpisodes(showId, input.mode)
                if (data?.episodes?.length) return data
              } catch (e) {
                if ((e as Error).message === 'AUTH_REQUIRED') throw e
              }
            }
          }
          return { episodes }
        }
        const providerName = input.provider?.toLowerCase()
        const provider = providerName ? providers[providerName] : undefined
        if (provider) {
          try {
            const data = await provider.getEpisodes(showId, input.mode)
            if (data?.episodes?.length) return data
          } catch (e) {
            if ((e as Error).message === 'AUTH_REQUIRED') throw e
          }
        }
        return { episodes: [] }
      },
      defaultValidate
    )
  }),

  showMeta: protectedProcedure.input(dataShowMetaInput()).query(async ({ ctx, input }) => {
    const showIdRaw = input.id
    return cached(
      ctx,
      `meta-${showIdRaw}`,
      3600,
      async () => {
        const db = ctx.db
        const id = await getMigratedId(db, showIdRaw)
        if (isTempShowId(id)) {
          const row = await TempShowIdsRepository.getById(db, id)
          if (!row || !isMatureStreamingProvider(ctx, row.provider)) return {}
          return {
            _id: row.id,
            id: row.id,
            name: row.title,
            englishName: row.title,
            thumbnail: row.thumbnail || '',
            type: 'TV',
            isAdult: true,
            status: 'UNKNOWN',
            provider: row.provider,
            nativeId: row.nativeId,
          }
        }
        const isNumeric = /^(mal-\d+|-?\d+)$/i.test(id)
        if (isNumeric) {
          let meta: Show | null = null
          try {
            meta = await getShowMetaById(id)
          } catch (e) {
            logger.warn({ err: e, id }, 'AniList show-meta fetch failed, trying local cache')
            const localMeta = (await ShowsMetaRepository.getById(db, id)) as Record<
              string,
              unknown
            > | null
            if (localMeta) {
              if (typeof localMeta.genres === 'string') {
                try {
                  localMeta.genres = JSON.parse(localMeta.genres as string)
                } catch {
                  localMeta.genres = []
                }
              }
              return localMeta
            }
          }
          if (meta) {
            const poster = meta.thumbnail?.trim() ? meta.thumbnail : undefined
            const hasPoster = !!poster
            try {
              await ShowsMetaRepository.upsert(db, {
                id,
                name: meta.name,
                thumbnail: poster,
                nativeName: meta.nativeName,
                englishName: meta.englishName,
                popularityScore:
                  meta.score ?? (meta.averageScore != null ? meta.averageScore / 10 : undefined),
                genres: meta.genres
                  ? JSON.stringify(
                      meta.genres.map((g) => (typeof g === 'string' ? g : g?.name)).filter(Boolean)
                    )
                  : undefined,
                status: meta.status,
                episodeCount: meta.episodeCount != null ? Number(meta.episodeCount) : undefined,
                type: meta.type,
                anilistId: meta.anilistId,
              })
            } catch {
              // ignore
            }
            if (hasPoster && poster) {
              const existingWatchlist = (await WatchlistRepository.getById(db, id)) as {
                thumbnail?: string
              } | null
              if (existingWatchlist && existingWatchlist.thumbnail !== poster) {
                try {
                  await WatchlistRepository.updateThumbnail(db, id, poster)
                } catch {
                  // ignore
                }
              }
            }
          }
          if (/^(mal-\d+|-\d+)$/i.test(id) && meta?.anilistId && meta.anilistId > 0) {
            try {
              LegacyIdMappingRepository.set(db, id, String(meta.anilistId))
            } catch {
              // ignore
            }
          }
          return meta || {}
        }
        return {}
      },
      (d) => !!d
    )
  }),

  video: protectedProcedure.input(dataVideoInput()).query(async ({ ctx, input }) => {
    const db = ctx.db
    const providers = ctx.getProviders()
    try {
      let showId = input.showId as string
      const videoMalId = parseMalId(showId)
      if (videoMalId) {
        try {
          const malMeta = await getShowMetaByMalId(videoMalId)
          if (malMeta?.anilistId && malMeta.anilistId > 0) showId = String(malMeta.anilistId)
        } catch {
          // ignore
        }
      }
      if (isTempShowId(showId)) {
        try {
          const row = await TempShowIdsRepository.getById(db, showId)
          if (!row || !isMatureStreamingProvider(ctx, row.provider)) return []
          const wanted = String(input.provider || '').toLowerCase()
          const own = providers[row.provider]
          if (own && (!wanted || wanted === row.provider)) {
            const urls = await own.getStreamUrls(
              row.nativeId,
              input.episodeNumber as string,
              input.mode
            )
            return urls || []
          }
          const hit = await resolveMatureStreamingId(ctx, row.title, wanted)
          if (hit) {
            const urls = await hit.provider.getStreamUrls(
              hit.nativeId,
              input.episodeNumber as string,
              input.mode
            )
            return urls || []
          }
        } catch (e) {
          logger.error({ err: e, showId }, 'Temp show video fetch failed')
        }
        return []
      }
      const providerName = input.provider as string
      const providerKey = providerName?.toLowerCase()
      const stillMal = parseMalId(showId) !== null
      const isNativeId = !!(providerKey && providers[providerKey]?.isDirectId?.(showId))
      const needsResolution = !isNativeId && (/^\d+$/.test(showId) || stillMal)
      if (providerKey && needsResolution) {
        const meta = (await ShowsMetaRepository.getById(db, showId)) as {
          name?: string
          englishName?: string
        } | null
        let targetTitle = meta?.englishName || meta?.name
        let anilistShow: Show | null = null
        if (!targetTitle) {
          try {
            anilistShow = await getShowMetaById(showId)
            targetTitle = anilistShow?.englishName || anilistShow?.name
            if (anilistShow && targetTitle) {
              await ShowsMetaRepository.upsert(db, {
                id: showId,
                name: anilistShow.name,
                thumbnail: anilistShow.thumbnail,
                nativeName: anilistShow.nativeName,
                englishName: anilistShow.englishName,
                genres: anilistShow.genres
                  ? JSON.stringify(anilistShow.genres.map((genre) => genre.name))
                  : undefined,
                status: anilistShow.status,
                episodeCount:
                  anilistShow.episodeCount != null ? Number(anilistShow.episodeCount) : undefined,
                type: anilistShow.type,
                anilistId: anilistShow.anilistId,
              })
            }
          } catch (err) {
            logger.warn(
              { err, provider: providerKey, showId },
              '[Video] AniList metadata lookup failed while resolving numeric showId'
            )
          }
        }
        if (targetTitle) {
          let romaji = anilistShow?.names?.romaji
          let nativeName: string | undefined = anilistShow?.names?.native
          let synonyms: string[] | undefined = anilistShow?.names?.synonyms
          if (!romaji || !nativeName) {
            try {
              const show = await getShowMetaById(showId)
              romaji = romaji || show?.names?.romaji
              nativeName = nativeName || show?.names?.native
              synonyms = synonyms || show?.names?.synonyms
            } catch {
              // ignore
            }
          }
          const titleTargets = [
            targetTitle,
            romaji,
            nativeName,
            ...(synonyms ?? []).slice(0, 2),
          ].filter((t): t is string => !!t && t.trim().length > 0)
          const distinctTargets = [...new Set(titleTargets.map((t) => t.trim()))].filter(
            (t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i
          )
          let resolved: string | null = null
          for (const variant of distinctTargets) {
            try {
              resolved =
                (await providers[providerKey]?.resolveShowId?.(variant, romaji, input.mode)) ?? null
            } catch (err) {
              if ((err as Error).message === 'AUTH_REQUIRED') throw err
              resolved = null
            }
            if (resolved) break
          }
          if (resolved) {
            showId = resolved
          } else {
            logger.warn(
              { provider: providerKey, showId, title: targetTitle, romaji },
              '[Video] resolveShowId failed, attempting fallback provider search'
            )
            try {
              const fallbackResults = await providers[providerKey]?.search?.({ query: targetTitle })
              const fallbackMatch = pickBestMatch(
                (fallbackResults || []).map((r) => ({
                  title: r.name || r.englishName || '',
                  id: r.id || r._id || '',
                })),
                distinctTargets
              )
              if (fallbackMatch) {
                showId = fallbackMatch.item.id
              } else {
                logger.warn(
                  { provider: providerKey, showId, title: targetTitle },
                  '[Video] fallback provider search returned no results'
                )
                return []
              }
            } catch (fallbackErr) {
              if ((fallbackErr as Error).message === 'AUTH_REQUIRED') {
                throw fallbackErr
              }
              logger.error(
                { err: fallbackErr, provider: providerKey, showId, title: targetTitle },
                '[Video] fallback provider search failed'
              )
              return []
            }
          }
        } else {
          logger.warn(
            { provider: providerKey, showId },
            '[Video] numeric showId passed to provider but local meta missing title'
          )
          return []
        }
      }
      const provider = getProvider(ctx, input.provider)
      if (!provider) return []
      const urls = await provider.getStreamUrls(showId, input.episodeNumber as string, input.mode)
      return urls || []
    } catch (e) {
      if ((e as Error).message === 'AUTH_REQUIRED') {
        throw authRequiredError(
          (e as Error & { provider?: string }).provider || input.provider || 'animepahe'
        )
      }
      logger.error({ err: e, provider: input.provider }, 'Provider video fetch failed')
      return []
    }
  }),
})
