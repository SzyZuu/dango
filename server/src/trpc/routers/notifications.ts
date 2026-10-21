import { protectedProcedure, router } from '../index.js'
import logger from '../../logger.js'
import { performWriteTransactionAsync } from '../../sync.js'
import { WatchlistRepository } from '../../repositories/watchlist.repository.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { NotificationsRepository } from '../../repositories/notifications.repository.js'
import { notificationDismissInput, defineSchema, reqObj, reqStr } from '../validation.js'

interface EpisodeNotification {
  showId: string
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
  episodeNumber: string
  id: string
}

type ClearAllInput = { showId?: string } | undefined

type ClearAllOutput = { showId?: string }

const clearAllInput = () =>
  defineSchema<ClearAllInput, ClearAllOutput>((value) => {
    if (value === undefined || value === null) return {}
    const obj = reqObj(value)
    if (obj.showId === undefined || obj.showId === null) return {}
    return { showId: reqStr(obj, 'showId') }
  })

export const notificationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const watchingShows = await WatchlistRepository.getWatchingShows(ctx.db)

    const notifications: EpisodeNotification[] = []

    for (const show of watchingShows) {
      try {
        const [watchedEps, dismissedEps, discoveredEps] = await Promise.all([
          WatchedEpisodesRepository.getWatchedEpisodeNumbers(ctx.db, show.id),
          NotificationsRepository.getDismissedByShow(ctx.db, show.id),
          NotificationsRepository.getDiscoveredByShow(ctx.db, show.id),
        ])

        const watchedSet = new Set(watchedEps.map((e) => e.toString()))
        const dismissedSet = new Set(dismissedEps.map((e) => e.episodeNumber.toString()))

        for (const discovered of discoveredEps) {
          if (
            !watchedSet.has(discovered.episodeNumber) &&
            !dismissedSet.has(discovered.episodeNumber)
          ) {
            notifications.push({
              showId: show.id,
              name: show.name,
              nativeName: show.nativeName,
              englishName: show.englishName,
              thumbnail: show.thumbnail,
              episodeNumber: discovered.episodeNumber,
              id: `${show.id}-${discovered.episodeNumber}`,
            })
          }
        }
      } catch (e) {
        logger.error({ err: e, showId: show.id }, 'Failed to get notifications for show')
      }
    }

    return notifications.sort((a, b) => parseFloat(b.episodeNumber) - parseFloat(a.episodeNumber))
  }),

  dismiss: protectedProcedure.input(notificationDismissInput()).mutation(async ({ ctx, input }) => {
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await NotificationsRepository.addDismissed(tx, input.showId, input.episodeNumber)
    })
    return { success: true }
  }),

  clearAll: protectedProcedure.input(clearAllInput()).mutation(async ({ ctx, input }) => {
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await NotificationsRepository.dismissFromDiscovered(tx, input.showId)
    })
    return { success: true }
  }),
})
