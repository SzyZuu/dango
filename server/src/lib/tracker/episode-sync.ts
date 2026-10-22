import type { DatabaseWrapper } from '../../db.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { dbGet } from '../../utils/db-utils.js'
import { offlineDb } from '../offline-db/index.js'
import { parseMalId } from '../anilist/index.js'
import { AniListTracker } from './anilist-tracker.js'
import { MAL_KEYS, MalTracker } from './mal-tracker.js'
import logger from '../../logger.js'
import { withTrackerLock } from './sync-lock.js'

type Provider = 'anilist' | 'mal'
interface Update {
  provider: Provider
  showId: string
  progress: number
  status: string
}

export function createTrackerUpdatesTable(db: DatabaseWrapper) {
  db.run(`CREATE TABLE IF NOT EXISTS tracker_updates (
    provider TEXT NOT NULL, showId TEXT NOT NULL, progress INTEGER NOT NULL, status TEXT NOT NULL,
    syncedProgress INTEGER NOT NULL DEFAULT -1, syncedStatus TEXT NOT NULL DEFAULT '', error TEXT,
    nextAttempt INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(provider, showId))`)
}

// Imported/manual watched markers have no playback duration. Partial playback must not count.
export async function completedProgress(db: DatabaseWrapper, showId: string): Promise<number> {
  const episodes = await WatchedEpisodesRepository.getByShow(db, showId)
  return Math.max(
    0,
    ...episodes
      .filter(
        (ep) =>
          /^\d+$/.test(ep.episodeNumber) &&
          Number(ep.episodeNumber) > 0 &&
          ((ep.duration === 0 && ep.currentTime === 0) ||
            (ep.duration > 0 && ep.currentTime >= ep.duration * 0.8))
      )
      .map((ep) => Number(ep.episodeNumber))
  )
}

export async function trackerIds(db: DatabaseWrapper, showId: string) {
  const meta = dbGet<{ anilistId?: number }>(db, 'SELECT anilistId FROM shows_meta WHERE id = ?', [
    showId,
  ])
  const anilistId =
    meta?.anilistId && meta.anilistId > 0
      ? meta.anilistId
      : /^\d+$/.test(showId)
        ? Number(showId)
        : undefined
  let malId =
    parseMalId(showId) ||
    Number((await SettingsRepository.getByKey(db, `tracker_mal_link_${showId}`))?.value) ||
    undefined
  if (!malId && anilistId) malId = offlineDb.getByAnilistId(anilistId)?.malId
  if (!malId && anilistId) {
    const data = await new AniListTracker().request<{ Media: { idMal?: number } | null }>(
      'query ($id: Int) { Media(id: $id, type: ANIME) { idMal } }',
      { id: anilistId },
      { retries: 0 }
    )
    malId = data.Media?.idMal
    if (malId) await SettingsRepository.upsert(db, `tracker_mal_link_${showId}`, String(malId))
  }
  return { anilistId, malId }
}

// Called inside the same transaction as the playback update. Each provider has its own acknowledgement.
export async function queueEpisodeSync(
  db: DatabaseWrapper,
  showId: string,
  explicitStatus?: string
) {
  const progress = await completedProgress(db, showId)
  if (!progress && !explicitStatus) return
  const meta = dbGet<{ episodeCount?: number }>(
    db,
    'SELECT episodeCount FROM shows_meta WHERE id = ?',
    [showId]
  )
  const status =
    explicitStatus ||
    (meta?.episodeCount && progress >= meta.episodeCount ? 'Completed' : 'Watching')
  for (const provider of ['anilist', 'mal'] as const) {
    const key = provider === 'mal' ? MAL_KEYS.tokens : 'tracker_anilist_token'
    if (!(await SettingsRepository.getByKey(db, key))?.value) continue
    db.run(
      `INSERT INTO tracker_updates (provider, showId, progress, status) VALUES (?, ?, ?, ?)
      ON CONFLICT(provider, showId) DO UPDATE SET
      nextAttempt = CASE WHEN excluded.progress > tracker_updates.progress THEN 0 ELSE tracker_updates.nextAttempt END,
      progress = MAX(tracker_updates.progress, excluded.progress),
      status = CASE WHEN excluded.progress >= tracker_updates.progress THEN excluded.status ELSE tracker_updates.status END`,
      [provider, showId, progress, status]
    )
  }
}

export function trackerUpdateStatus(db: DatabaseWrapper, provider: Provider) {
  return (
    dbGet<{ pending: number; error: string | null }>(
      db,
      `SELECT COUNT(*) AS pending, MAX(error) AS error FROM tracker_updates
    WHERE provider = ? AND (progress != syncedProgress OR status != syncedStatus)`,
      [provider]
    ) || { pending: 0, error: null }
  )
}

const running = new WeakMap<DatabaseWrapper, Promise<void>>()
export function flushEpisodeSync(db: DatabaseWrapper, force = false): Promise<void> {
  const existing = running.get(db)
  if (existing) return existing
  const run = (async () => {
    // Provider loops run independently: an AniList outage must not delay MAL updates.
    await Promise.all(
      (['anilist', 'mal'] as const).map((provider) =>
        withTrackerLock(db, provider, async () => {
          const updates = db.all<Update>(
            `SELECT provider, showId, progress, status FROM tracker_updates
        WHERE provider = ? AND (progress != syncedProgress OR status != syncedStatus) AND nextAttempt <= ?`,
            [provider, force ? Number.MAX_SAFE_INTEGER : Date.now()]
          )
          for (const update of updates) {
            try {
              if (db.isClosedCheck()) return
              if (provider === 'mal') {
                if (!(await SettingsRepository.getByKey(db, MAL_KEYS.tokens))?.value) continue
                const { malId } = await trackerIds(db, update.showId)
                if (!malId)
                  throw new Error(
                    'No exact MyAnimeList ID mapping is available for this title. Sync again after refreshing the offline database.'
                  )
                const tracker = new MalTracker(db)
                const anime = await tracker.getAnime(malId)
                const progress = Math.max(
                  update.progress,
                  anime.my_list_status?.num_episodes_watched || 0
                )
                const status =
                  update.status === 'Watching' &&
                  anime.num_episodes &&
                  progress >= anime.num_episodes
                    ? 'Completed'
                    : update.status
                await tracker.update(malId, progress, status)
              } else {
                const token = (await SettingsRepository.getByKey(db, 'tracker_anilist_token'))
                  ?.value
                if (!token) continue
                const meta = dbGet<{ anilistId: number }>(
                  db,
                  'SELECT anilistId FROM shows_meta WHERE id = ?',
                  [update.showId]
                )
                const mediaId =
                  meta?.anilistId ||
                  (/^\d+$/.test(update.showId)
                    ? Number(update.showId)
                    : offlineDb.getByMalId(parseMalId(update.showId) || 0)?.anilistId)
                if (!mediaId || mediaId <= 0)
                  throw new Error('No exact AniList ID mapping is available for this title.')
                const tracker = new AniListTracker(token)
                const data = await tracker.request<{
                  Media: { episodes?: number; mediaListEntry?: { progress: number } } | null
                }>(
                  'query ($id: Int) { Media(id: $id, type: ANIME) { episodes mediaListEntry { progress } } }',
                  { id: mediaId },
                  { retries: 0 }
                )
                const progress = Math.max(
                  update.progress,
                  data.Media?.mediaListEntry?.progress || 0
                )
                await tracker.updateMediaEntry({
                  mediaId,
                  progress,
                  status:
                    update.status === 'Watching' &&
                    data.Media?.episodes &&
                    progress >= data.Media.episodes
                      ? 'Completed'
                      : update.status,
                })
              }
              // Do not acknowledge a newer episode queued while this request was in flight.
              db.run(
                `UPDATE tracker_updates SET syncedProgress = ?, syncedStatus = ?, error = NULL
            WHERE provider = ? AND showId = ? AND progress = ? AND status = ?`,
                [
                  update.progress,
                  update.status,
                  provider,
                  update.showId,
                  update.progress,
                  update.status,
                ]
              )
            } catch {
              if (db.isClosedCheck()) return
              // Keep credentials, authorization codes, and response bodies out of logs and UI errors.
              const error = `Could not update ${provider === 'mal' ? 'MyAnimeList' : 'AniList'}. Check the connection and title mapping; this update will retry.`
              db.run(
                'UPDATE tracker_updates SET error = ?, nextAttempt = ? WHERE provider = ? AND showId = ?',
                [error, Date.now() + 60000, provider, update.showId]
              )
              logger.warn(
                { provider, showId: update.showId },
                'Tracker episode update pending retry'
              )
            }
          }
        })
      )
    )
  })().finally(() => running.delete(db))
  running.set(db, run)
  return run
}

export function startEpisodeSync(db: DatabaseWrapper) {
  createTrackerUpdatesTable(db)
  const flush = () => {
    if (!db.isClosedCheck()) void flushEpisodeSync(db).catch(() => {})
  }
  flush()
  const timer = setInterval(flush, 60000)
  timer.unref()
  return () => clearInterval(timer)
}
