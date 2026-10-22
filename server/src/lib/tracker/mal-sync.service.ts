import type { DatabaseWrapper } from '../../db.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { WatchlistRepository } from '../../repositories/watchlist.repository.js'
import { ShowsMetaRepository } from '../../repositories/shows-meta.repository.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { performWriteTransactionAsync } from '../../db/transaction.js'
import { offlineDb } from '../offline-db/index.js'
import { MalTracker, MAL_TO_DANGO } from './mal-tracker.js'
import { completedProgress, trackerIds } from './episode-sync.js'
import { resolveStatus, readTrackerSyncState } from './sync-state.js'
import type { SyncSummary } from './anime-sync/index.js'
import { withTrackerLock } from './sync-lock.js'

const syncing = new WeakMap<DatabaseWrapper, Promise<SyncSummary>>()
export function syncMyAnimeList(db: DatabaseWrapper): Promise<SyncSummary> {
  const existing = syncing.get(db)
  if (existing) return existing
  const run = withTrackerLock(db, 'mal', () => sync(db)).finally(() => syncing.delete(db))
  syncing.set(db, run)
  return run
}

async function sync(db: DatabaseWrapper): Promise<SyncSummary> {
  const tracker = new MalTracker(db)
  const remote = await tracker.fetchList()
  const local = await WatchlistRepository.getAll(db)
  const summary: SyncSummary = { pushed: 0, pulled: 0, merged: 0, unchanged: 0, errors: [] }
  const state = await readTrackerSyncState(db, 'tracker_mal_sync_state')
  const mapped = new Map<number, (typeof local)[number]>()
  for (const item of local) {
    try {
      const { malId } = await trackerIds(db, item.id)
      if (malId) mapped.set(malId, item)
      else summary.errors.push(`${item.name}: No exact MAL ID mapping; skipped.`)
    } catch {
      summary.errors.push(`${item.name}: MAL ID lookup failed; skipped.`)
    }
  }
  const now = Math.floor(Date.now() / 1000)
  for (const entry of remote) {
    const id = entry.node.id
    const item = mapped.get(id)
    mapped.delete(id)
    const showId = item?.id || String(offlineDb.getByMalId(id)?.anilistId || `mal-${id}`)
    try {
      const remoteStatus = MAL_TO_DANGO[entry.list_status.status]
      if (!remoteStatus) continue
      const localProgress = await completedProgress(db, showId)
      const remoteProgress = entry.list_status.num_episodes_watched
      const progress = Math.max(localProgress, remoteProgress)
      const remoteUpdated = Math.floor(Date.parse(entry.list_status.updated_at || '') / 1000) || 0
      const { status } = item
        ? resolveStatus(
            item.status,
            remoteStatus,
            remoteUpdated,
            state[String(id)]?.lastSyncedAt || 0
          )
        : { status: remoteStatus }
      if (item && (progress > remoteProgress || status !== remoteStatus))
        await tracker.update(id, progress, status)
      await performWriteTransactionAsync(db, async (tx) => {
        await SettingsRepository.upsert(tx, `tracker_mal_link_${showId}`, String(id))
        await WatchlistRepository.upsert(tx, {
          id: showId,
          name: item?.name || entry.node.title,
          thumbnail:
            item?.thumbnail ||
            entry.node.main_picture?.large ||
            entry.node.main_picture?.medium ||
            '',
          status,
          nativeName: item?.nativeName || '',
          englishName: item?.englishName || '',
          type: item?.type || 'TV',
        })
        await ShowsMetaRepository.upsert(tx, {
          id: showId,
          name: entry.node.title,
          episodeCount: entry.node.num_episodes,
          anilistId: offlineDb.getByMalId(id)?.anilistId,
        })
        for (let ep = 1; ep <= remoteProgress; ep++)
          await WatchedEpisodesRepository.markCompleted(tx, { showId, episodeNumber: String(ep) })
        tx.run(
          `UPDATE tracker_updates SET syncedProgress = progress, syncedStatus = status, error = NULL
          WHERE provider = 'mal' AND showId = ? AND progress <= ?`,
          [showId, progress]
        )
        state[String(id)] = { lastSyncedAt: now, remoteUpdatedAt: remoteUpdated }
        await SettingsRepository.upsert(tx, 'tracker_mal_sync_state', JSON.stringify(state))
      })
      if (!item) summary.pulled++
      else if (
        localProgress !== remoteProgress ||
        status !== item.status ||
        status !== remoteStatus
      )
        summary.merged++
      else summary.unchanged++
    } catch {
      summary.errors.push(`${entry.node.title}: Sync failed. Your local progress has been kept.`)
    }
  }
  for (const [id, item] of mapped) {
    try {
      await tracker.update(id, await completedProgress(db, item.id), item.status)
      summary.pushed++
    } catch {
      summary.errors.push(`${item.name}: Could not send to MyAnimeList.`)
    }
  }
  // No deletion propagation: an absent or private list must never erase a library.
  return summary
}
