import { protectedProcedure, router } from '../index.js'
import { failed } from '../validation.js'
import { cached } from '../cache.js'
import logger from '../../logger.js'
import {
  getTrending,
  getLatestReleases,
  getSeasonal,
  getSchedule,
  searchAnilist,
  getSpotlightBanners,
  getGenreTagLists,
  anilistUnavailable,
  wasAnilistDownAtBoot,
  checkAnilistStatus,
} from '../../lib/anilist.js'
import {
  dataScheduleInput,
  dataLatestReleasesInput,
  dataSearchInput,
  dataSeasonalInput,
  dataPopularListInput,
} from '../schemas/data.js'
import { parseListParam } from '../../lib/resolve-show.js'

const defaultValidate = (d: unknown) => Array.isArray(d) && d.length > 0

export const dataCatalogRouter = router({
  schedule: protectedProcedure.input(dataScheduleInput()).query(async ({ ctx, input }) => {
    const date = input.date
    const format = input.format || 'TV'
    return cached(
      ctx,
      `schedule-${date}-${format}`,
      1800,
      async () => {
        try {
          const dateObj = new Date(date + 'T00:00:00.000Z')
          const adult = format === 'ADULT'
          return await getSchedule(dateObj, adult ? undefined : format, adult)
        } catch (e) {
          logger.error({ err: e, date }, 'Schedule fetch failed')
          return []
        }
      },
      defaultValidate
    )
  }),

  latestReleases: protectedProcedure
    .input(dataLatestReleasesInput())
    .query(async ({ ctx, input }) => {
      const formatStr = input.format || 'TV'
      const pageNum = input.page || 1
      const sizeNum = input.size || 12
      return cached(
        ctx,
        `latest-releases-${formatStr}-${pageNum}-${sizeNum}`,
        300,
        async () => {
          try {
            return await getLatestReleases(formatStr, pageNum, sizeNum)
          } catch (e) {
            logger.error({ err: e }, 'Latest releases fetch failed')
            return []
          }
        },
        defaultValidate
      )
    }),

  search: protectedProcedure.input(dataSearchInput()).query(async ({ ctx, input }) => {
    const queryEntries: Record<string, string> = {}
    if (input.query !== undefined) queryEntries.query = input.query
    if (input.page !== undefined) queryEntries.page = String(input.page)
    if (input.limit !== undefined) queryEntries.limit = String(input.limit)
    if (input.sortBy !== undefined) queryEntries.sortBy = input.sortBy
    if (input.type !== undefined) queryEntries.type = input.type
    if (input.status !== undefined) queryEntries.status = input.status
    if (input.season !== undefined) queryEntries.season = input.season
    if (input.year !== undefined) queryEntries.year = String(input.year)
    if (input.country !== undefined) queryEntries.country = input.country
    if (input.genres !== undefined) queryEntries.genres = input.genres
    if (input.excludeGenres !== undefined) queryEntries.excludeGenres = input.excludeGenres
    if (input.excludeTags !== undefined) queryEntries.excludeTags = input.excludeTags
    if (input.minScore !== undefined) queryEntries.minScore = String(input.minScore)
    if (input.minEpisodes !== undefined) queryEntries.minEpisodes = String(input.minEpisodes)
    if (input.adult !== undefined) queryEntries.adult = input.adult
    return cached(
      ctx,
      `search-${JSON.stringify(queryEntries)}`,
      1800,
      async () => {
        try {
          return await searchAnilist({
            query: input.query || '',
            page: input.page || 1,
            perPage: input.limit || 14,
            format: input.type,
            status: input.status,
            season: input.season,
            seasonYear: input.year,
            countryOfOrigin: input.country,
            genre: input.genres,
            genre_not_in: parseListParam(input.excludeGenres),
            tag_not_in: parseListParam(input.excludeTags),
            averageScore_greater: input.minScore,
            episodes_greater: input.minEpisodes,
            isAdult: input.adult === 'true' ? true : input.adult === 'false' ? false : undefined,
            sort: input.sortBy,
          })
        } catch (e) {
          logger.error({ err: e }, 'search failed')
          return []
        }
      },
      defaultValidate
    )
  }),

  seasonal: protectedProcedure.input(dataSeasonalInput()).query(async ({ ctx, input }) => {
    const pageNum = input.page || 1
    const sizeNum = input.size || 14
    const formatStr = input.format
    return cached(
      ctx,
      `seasonal-${formatStr || 'ALL'}-${pageNum}-${sizeNum}`,
      300,
      async () => {
        try {
          return await getSeasonal(pageNum, sizeNum, formatStr)
        } catch (e) {
          logger.error({ err: e }, 'Seasonal fetch failed')
          return []
        }
      },
      defaultValidate
    )
  }),

  popularList: protectedProcedure.input(dataPopularListInput()).query(async ({ ctx, input }) => {
    const sort = input.sort === 'POPULARITY_DESC' ? 'POPULARITY_DESC' : 'TRENDING_DESC'
    const pageNum = input.page || 1
    const sizeNum = input.size || 20
    return cached(
      ctx,
      `popular-list-${input.sort || 'TRENDING_DESC'}-${pageNum}-${sizeNum}`,
      300,
      async () => {
        try {
          return await getTrending(pageNum, sizeNum, sort)
        } catch (e) {
          logger.error({ err: e }, 'Popular list fetch failed')
          return []
        }
      },
      defaultValidate
    )
  }),

  spotlight: protectedProcedure.query(async ({ ctx }) => {
    return cached(
      ctx,
      'spotlight',
      300,
      async () => {
        try {
          return await getSpotlightBanners(1, 20)
        } catch (e) {
          logger.error({ err: e }, 'Spotlight fetch failed')
          return []
        }
      },
      defaultValidate
    )
  }),

  genresAndTags: protectedProcedure.query(async () => {
    try {
      return await getGenreTagLists()
    } catch (e) {
      logger.error({ err: e }, 'genres-and-tags failed')
      throw failed('Failed to load genres')
    }
  }),

  anilistStatus: protectedProcedure.query(async () => {
    const available = !anilistUnavailable()
    if (!available) {
      checkAnilistStatus().catch(() => {})
    }
    return { available, wasDownAtBoot: wasAnilistDownAtBoot() }
  }),

  systemNotifications: protectedProcedure.query(async () => {
    interface SystemNotification {
      id: string
      type: string
      title: string
      message: string
      icon: string
      createdAt: number
    }
    const notifications: SystemNotification[] = []
    if (wasAnilistDownAtBoot() && anilistUnavailable()) {
      const fb = 'MAL + Kitsu'
      notifications.push({
        id: 'system-anilist-down',
        type: 'system',
        title: 'AniList API',
        message: `AniList metadata API is currently down. dango is experiencing degraded performance. ${fb} is being used as a fallback in the meantime. Some features may be limited until service is restored.`,
        icon: 'warning',
        createdAt: Date.now(),
      })
    }
    return notifications
  }),
})
