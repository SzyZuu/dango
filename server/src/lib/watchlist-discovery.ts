import logger from '../logger.js'
import type { DatabaseWrapper } from '../db.js'
import { WatchlistRepository } from '../repositories/watchlist.repository.js'
import { WatchedEpisodesRepository } from '../repositories/watched-episodes.repository.js'
import { ShowsMetaRepository } from '../repositories/shows-meta.repository.js'
import { NotificationsRepository } from '../repositories/notifications.repository.js'
import {
  getAiredEpisodesForShows,
  isAnilistRateLimited,
  batchGetShowStatuses,
} from './anilist/index.js'

const BACKGROUND_DISCOVERY_INTERVAL_MS = 5 * 60 * 1000
const NUDGE_THROTTLE_MS = 120 * 1000
const SLOW_MAX_RUN_MS = 5 * 60 * 1000

let discoveryIntervalId: ReturnType<typeof setInterval> | null = null
let lastExternalDiscoveryAt = 0
let discoveryBusy = false
let lastDiscoveryRunAt = 0
let discoveryState: 'idle' | 'running' | 'complete' | 'empty' | 'error' = 'idle'
let discoveryTotal = 0
let discoveryDone = 0
let discoveryStopped = false
let triggerImpl: (() => boolean) | null = null

export function triggerWatchlistDiscovery(): boolean {
  return triggerImpl?.() ?? false
}

export function stopWatchlistDiscovery(): void {
  discoveryStopped = true
  if (discoveryIntervalId !== null) {
    clearInterval(discoveryIntervalId)
    discoveryIntervalId = null
  }
}

export function getWatchlistDiscoveryStatus(): {
  running: boolean
  state: 'idle' | 'running' | 'complete' | 'empty' | 'error'
  total: number
  done: number
  lastRunAt: number
} {
  return {
    running: discoveryBusy,
    state: discoveryState,
    total: discoveryTotal,
    done: Math.min(discoveryDone, discoveryTotal),
    lastRunAt: lastDiscoveryRunAt,
  }
}

export function startWatchlistDiscovery(getDb: () => DatabaseWrapper): void {
  const anilistIdCache = new Map<string, number | null>()

  const getAnilistId = async (showId: string): Promise<number | null> => {
    if (anilistIdCache.has(showId)) {
      return anilistIdCache.get(showId) || null
    }

    const db = getDb()
    const meta = (await ShowsMetaRepository.getById(db, showId)) as { anilistId?: number } | null
    if (meta?.anilistId) {
      anilistIdCache.set(showId, meta.anilistId)
      return meta.anilistId
    }

    if (/^\d+$/.test(showId)) {
      const numericId = parseInt(showId)
      anilistIdCache.set(showId, numericId)
      return numericId
    }

    anilistIdCache.set(showId, null)
    return null
  }

  const runDiscovery = async (fast = false): Promise<void> => {
    if (discoveryBusy || discoveryStopped) return
    discoveryBusy = true
    discoveryState = 'running'
    discoveryTotal = 0
    discoveryDone = 0

    const db = getDb()
    if (!db || db.isClosedCheck()) {
      discoveryBusy = false
      return
    }

    const startedAt = Date.now()
    const MAX_RUN_MS = fast ? 90000 : SLOW_MAX_RUN_MS

    try {
      const watchingShows = await WatchlistRepository.getWatchingShows(db)
      discoveryTotal = watchingShows.length
      if (watchingShows.length === 0) {
        discoveryBusy = false
        return
      }

      const showIdMap = new Map<string, number>()
      const MAP_CONCURRENCY = fast ? 4 : 2
      const anilistResults: { show: (typeof watchingShows)[number]; id: number | null }[] = []
      let nextIndex = 0
      const worker = async (): Promise<void> => {
        while (nextIndex < watchingShows.length) {
          if (Date.now() - startedAt > MAX_RUN_MS) return
          const show = watchingShows[nextIndex]
          nextIndex += 1
          const id = await getAnilistId(show.id)
          discoveryDone += 1
          anilistResults.push({ show, id })
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(MAP_CONCURRENCY, watchingShows.length) }, () => worker())
      )
      for (const { show, id } of anilistResults) {
        if (id) {
          showIdMap.set(show.id, id)
        }
      }

      if (Date.now() - startedAt > MAX_RUN_MS || showIdMap.size === 0) {
        discoveryBusy = false
        return
      }

      const now = new Date()
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - 7)
      weekStart.setHours(0, 0, 0, 0)
      const weekEnd = new Date(now)
      weekEnd.setHours(23, 59, 59, 999)

      const schedules = await getAiredEpisodesForShows(
        Array.from(showIdMap.values()),
        weekStart,
        weekEnd
      )

      const nowUnix = Math.floor(Date.now() / 1000)
      const reverseMap = new Map<number, string>()
      for (const [watchlistId, anilistId] of showIdMap.entries()) {
        reverseMap.set(anilistId, watchlistId)
      }

      const finishedShowIds = new Set<number>()
      const unresolvedStatus: { watchlistId: string; anilistId: number }[] = []
      for (const [watchlistId, anilistId] of showIdMap.entries()) {
        const localMeta = (await ShowsMetaRepository.getById(db, watchlistId)) as {
          status?: string
        } | null
        if (localMeta?.status === 'FINISHED') {
          finishedShowIds.add(anilistId)
        } else if (!localMeta?.status) {
          unresolvedStatus.push({ watchlistId, anilistId })
        }
      }

      if (unresolvedStatus.length > 0 && !isAnilistRateLimited()) {
        const statuses = await batchGetShowStatuses(unresolvedStatus.map((s) => s.anilistId))
        let persisted = 0
        for (const { watchlistId, anilistId } of unresolvedStatus) {
          const status = statuses.get(anilistId)
          if (status === 'FINISHED') {
            finishedShowIds.add(anilistId)
            await ShowsMetaRepository.upsert(db, { id: watchlistId, status: 'FINISHED' })
            persisted++
          } else if (status) {
            await ShowsMetaRepository.upsert(db, { id: watchlistId, status })
            persisted++
          }
        }
      }

      if (finishedShowIds.size > 0) {
        const monthStart = new Date(now)
        monthStart.setDate(now.getDate() - 30)
        monthStart.setHours(0, 0, 0, 0)
        const monthEnd = new Date(now)
        monthEnd.setHours(23, 59, 59, 999)

        const finishedSchedules = await getAiredEpisodesForShows(
          Array.from(finishedShowIds),
          monthStart,
          monthEnd
        )

        const finishedEpisodesByShow = new Map<string, { episodeKey: string; airingAt: number }[]>()
        const seenFinishedKeys = new Set<string>()
        for (const entry of finishedSchedules) {
          if (entry.airingAt > nowUnix) continue
          const watchlistId = reverseMap.get(entry.mediaId)
          if (!watchlistId) continue
          const episodeKey = String(Math.round(entry.episode))
          const dedupeKey = `${watchlistId}:${episodeKey}`
          if (seenFinishedKeys.has(dedupeKey)) continue
          seenFinishedKeys.add(dedupeKey)
          const list = finishedEpisodesByShow.get(watchlistId)
          if (list) list.push({ episodeKey, airingAt: entry.airingAt })
          else finishedEpisodesByShow.set(watchlistId, [{ episodeKey, airingAt: entry.airingAt }])
        }

        for (const [watchlistId, episodes] of finishedEpisodesByShow) {
          const [watchedEps, dismissedEps] = await Promise.all([
            WatchedEpisodesRepository.getWatchedEpisodeNumbers(db, watchlistId),
            NotificationsRepository.getDismissedByShow(db, watchlistId),
          ])

          const watchedSet = new Set(watchedEps.map((e) => e.toString()))
          const dismissedSet = new Set(dismissedEps.map((e) => e.episodeNumber.toString()))

          for (const { episodeKey, airingAt } of episodes) {
            if (nowUnix - airingAt > 30 * 24 * 60 * 60) continue
            if (!watchedSet.has(episodeKey) && !dismissedSet.has(episodeKey)) {
              await NotificationsRepository.addDiscovered(db, watchlistId, episodeKey)
            }
          }
        }
      }

      const episodesByShow = new Map<string, { episodeKey: string; airingAt: number }[]>()
      const seenEpisodeKeys = new Set<string>()
      for (const entry of schedules) {
        if (entry.airingAt > nowUnix) continue

        const watchlistId = reverseMap.get(entry.mediaId)
        if (!watchlistId) continue

        const episodeKey = String(Math.round(entry.episode))
        const dedupeKey = `${watchlistId}:${episodeKey}`
        if (seenEpisodeKeys.has(dedupeKey)) continue
        seenEpisodeKeys.add(dedupeKey)
        const list = episodesByShow.get(watchlistId)
        if (list) list.push({ episodeKey, airingAt: entry.airingAt })
        else episodesByShow.set(watchlistId, [{ episodeKey, airingAt: entry.airingAt }])
      }

      for (const [watchlistId, episodes] of episodesByShow) {
        const [watchedEps, dismissedEps] = await Promise.all([
          WatchedEpisodesRepository.getWatchedEpisodeNumbers(db, watchlistId),
          NotificationsRepository.getDismissedByShow(db, watchlistId),
        ])

        const watchedSet = new Set(watchedEps.map((e) => e.toString()))
        const dismissedSet = new Set(dismissedEps.map((e) => e.episodeNumber.toString()))

        for (const { episodeKey } of episodes) {
          if (!watchedSet.has(episodeKey) && !dismissedSet.has(episodeKey)) {
            await NotificationsRepository.addDiscovered(db, watchlistId, episodeKey)
          }
        }
      }

      await NotificationsRepository.cleanupWatchedNotifications(db)
    } catch (e) {
      discoveryState = 'error'
      if ((e as Error)?.message === 'Database is closed') {
        logger.info('Notification discovery stopped: database is closed')
      } else {
        logger.error({ err: e }, 'AniList notification discovery failed')
      }
    } finally {
      discoveryBusy = false
      lastDiscoveryRunAt = Date.now()
      if (discoveryState === 'running') {
        discoveryState = discoveryTotal === 0 ? 'empty' : 'complete'
      }
    }
  }

  triggerImpl = () => {
    if (discoveryStopped || discoveryBusy) return false
    if (Date.now() - lastExternalDiscoveryAt < NUDGE_THROTTLE_MS) return false
    lastExternalDiscoveryAt = Date.now()
    runDiscovery(true)
    return true
  }

  discoveryIntervalId = setInterval(() => {
    if (!discoveryStopped) runDiscovery(false)
  }, BACKGROUND_DISCOVERY_INTERVAL_MS)
  discoveryIntervalId.unref()
}
