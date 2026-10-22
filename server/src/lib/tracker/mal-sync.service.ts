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
import logger from '../../logger.js'

const SYNC_STATE_KEY = 'tracker_mal_sync_state'

const syncing = new WeakMap<DatabaseWrapper, Promise<SyncSummary>>()
export function syncMyAnimeList(db: DatabaseWrapper): Promise<SyncSummary> {
  const existing = syncing.get(db)
  if (existing) return existing
  const run = withTrackerLock(db, 'mal', () => sync(db)).finally(() => syncing.delete(db))
  syncing.set(db, run)
  return run
}

interface WatchlistUpsert {
  id: string
  name: string
  thumbnail: string
  status: string
  nativeName: string
  englishName: string
  type: string
}

async function sync(db: DatabaseWrapper): Promise<SyncSummary> {
  const tracker = new MalTracker(db)
  const remote = await tracker.fetchList()
  const local = await WatchlistRepository.getAll(db)
  const summary: SyncSummary = { pushed: 0, pulled: 0, merged: 0, unchanged: 0, errors: [] }
  const state = await readTrackerSyncState(db, SYNC_STATE_KEY)
  const nextState = { ...state }
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
  const watchlistUpserts: WatchlistUpsert[] = []
  const metaUpserts: {
    id: string
    name: string
    episodeCount?: number
    anilistId?: number
  }[] = []
  const watchedRanges: { showId: string; to: number }[] = []
  const links: { key: string; value: string }[] = []

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
      watchlistUpserts.push({
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
      metaUpserts.push({
        id: showId,
        name: entry.node.title,
        episodeCount: entry.node.num_episodes,
        anilistId: offlineDb.getByMalId(id)?.anilistId,
      })
      if (remoteProgress > 0) watchedRanges.push({ showId, to: remoteProgress })
      links.push({ key: `tracker_mal_link_${showId}`, value: String(id) })
      nextState[String(id)] = { lastSyncedAt: now, remoteUpdatedAt: remoteUpdated }
      if (!item) summary.pulled++
      else if (
        localProgress !== remoteProgress ||
        status !== item.status ||
        status !== remoteStatus
      )
        summary.merged++
      else summary.unchanged++
    } catch (err) {
      logger.warn({ err, malId: id }, '[MyAnimeList Sync] Entry failed')
      summary.errors.push(`${entry.node.title}: Sync failed. Your local progress has been kept.`)
    }
  }

  if (watchlistUpserts.length > 0) {
    await performWriteTransactionAsync(db, async (tx) => {
      for (const link of links) await SettingsRepository.upsert(tx, link.key, link.value)
      for (const item of watchlistUpserts) await WatchlistRepository.upsert(tx, item)
      for (const meta of metaUpserts) await ShowsMetaRepository.upsert(tx, meta)
      for (const range of watchedRanges) {
        for (let ep = 1; ep <= range.to; ep++) {
          await WatchedEpisodesRepository.markCompleted(tx, {
            showId: range.showId,
            episodeNumber: String(ep),
          })
        }
      }
      await SettingsRepository.upsert(tx, SYNC_STATE_KEY, JSON.stringify(nextState))
    })
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
