import { protectedProcedure, router } from '../index.js'
import type { DatabaseWrapper } from '../../db.js'
import { performWriteTransactionAsync } from '../../db/transaction.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { NotificationsRepository } from '../../repositories/notifications.repository.js'
import { getMigratedId } from '../../lib/migration.js'
import { adultNonListIds } from '../../utils/db-utils.js'
import { idsInput, showIdInput } from '../validation.js'

const getAdultNonWatchlistShowIds = (db: DatabaseWrapper) =>
  adultNonListIds(
    db,
    'watched_episodes',
    'watchlist',
    'showId',
    '(SELECT isAdult FROM shows_meta WHERE id = p.showId) = 1'
  )

export const continueWatchingRouter = router({
  remove: protectedProcedure.input(showIdInput()).mutation(async ({ ctx, input }) => {
    const showId = await getMigratedId(ctx.db, input.showId)
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await WatchedEpisodesRepository.deleteByShow(tx, showId)
      await NotificationsRepository.deleteByShow(tx, showId)
    })
    return { success: true }
  }),

  removeMany: protectedProcedure.input(idsInput()).mutation(async ({ ctx, input }) => {
    const ids = await Promise.all(input.ids.map((id: string) => getMigratedId(ctx.db, id)))
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      for (const id of ids) {
        await WatchedEpisodesRepository.deleteByShow(tx, id)
        await NotificationsRepository.deleteByShow(tx, id)
      }
    })

    return { success: true, removed: ids.length }
  }),

  adultCount: protectedProcedure.query(async ({ ctx }) => {
    const ids = await getAdultNonWatchlistShowIds(ctx.db)
    return { count: ids.length }
  }),

  purgeAdult: protectedProcedure.mutation(async ({ ctx }) => {
    const ids = await getAdultNonWatchlistShowIds(ctx.db)
    if (ids.length > 0) {
      await performWriteTransactionAsync(ctx.db, async (tx) => {
        for (const id of ids) {
          await WatchedEpisodesRepository.deleteByShow(tx, id)
          await NotificationsRepository.deleteByShow(tx, id)
        }
      })
    }
    return { success: true, removed: ids.length }
  }),

  thisWeek: protectedProcedure.query(async ({ ctx }) => {
    const rows = await NotificationsRepository.getThisWeekDiscovered(ctx.db)

    return rows.map((row) => ({
      _id: row.id,
      id: row.id,
      name: row.name,
      thumbnail: row.thumbnail || '',
      nativeName: row.nativeName,
      englishName: row.englishName,
      type: row.type,
      episodeNumber: parseInt(row.episodeNumber) || row.episodeNumber,
    }))
  }),
})
