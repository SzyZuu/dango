import type { DatabaseWrapper } from '../../db.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import logger from '../../logger.js'
import { downloadOfflineDb } from './download.js'
import {
  backfillShowsMetaGenres,
  latestSaturdayUtc,
  loadEntries,
  SCHEMA_VERSION,
  storeEntries,
} from './store.js'
import type { OfflineDbInfo, OfflineEntry } from './types.js'

const log = logger.child({ module: 'OfflineDb' })
const INTERRUPTED_RETRY_COOLDOWN_MS = 60 * 60 * 1000

class OfflineDb {
  private malToEntry = new Map<number, OfflineEntry>()
  private anilistToMal = new Map<number, number>()
  private anilistToEntry = new Map<number, OfflineEntry>()
  private isInitialized = false
  private isRefreshing = false

  async init(db: DatabaseWrapper): Promise<void> {
    try {
      this.loadCache(db)
      log.info(`OfflineDb loaded ${this.malToEntry.size} MAL mappings from SQLite`)
      const wasInterrupted =
        (await SettingsRepository.getByKey(db, 'offlineDbLastStatus'))?.value === 'updating'
      const autoUpdateSetting = await SettingsRepository.getByKey(db, 'offlineDbAutoUpdateEnabled')
      const autoUpdateEnabled = !autoUpdateSetting || autoUpdateSetting.value !== 'false'
      this.backfillShowsMetaGenres(db)

      if (this.malToEntry.size === 0) {
        log.info('OfflineDb cache is empty. Starting background download...')
        this.refreshDatabase(db).catch((err) => {
          log.warn({ err: err?.message }, 'Background offline database download failed')
        })
      } else if (wasInterrupted && autoUpdateEnabled && (await this.interruptedRetryDue(db))) {
        log.info('Previous offline database refresh was interrupted. Retrying in background...')
        await SettingsRepository.upsert(db, 'offlineDbLastStatus', 'idle')
        await SettingsRepository.upsert(
          db,
          'offlineDbLastMessage',
          'Previous refresh was interrupted by a restart. Retrying automatically...'
        )
        this.refreshDatabase(db).catch((err) => {
          log.warn({ err: err?.message }, 'Interrupted offline database retry failed')
        })
      } else if (wasInterrupted) {
        await SettingsRepository.upsert(db, 'offlineDbLastStatus', 'idle')
        await SettingsRepository.upsert(
          db,
          'offlineDbLastMessage',
          'Previous refresh was interrupted by a restart. Trigger an update to retry.'
        )
      }

      this.isInitialized = true
    } catch (e) {
      log.error({ err: e }, 'Failed to initialize OfflineDb')
    }
  }

  backfillShowsMetaGenres(db: DatabaseWrapper): number {
    return backfillShowsMetaGenres(db)
  }

  private loadCache(db: DatabaseWrapper): void {
    try {
      this.malToEntry.clear()
      this.anilistToMal.clear()
      this.anilistToEntry.clear()
      for (const entry of loadEntries(db)) {
        this.malToEntry.set(entry.malId, entry)
        this.anilistToMal.set(entry.anilistId, entry.malId)
        this.anilistToEntry.set(entry.anilistId, entry)
      }
    } catch (err) {
      log.error({ err }, 'Failed to load offline mappings into memory')
    }
  }

  getByMalId(malId: number): OfflineEntry | null {
    return this.malToEntry.get(malId) ?? null
  }

  getByAnilistId(anilistId: number): OfflineEntry | null {
    return this.anilistToEntry.get(anilistId) ?? null
  }

  async getOfflineDbInfo(db: DatabaseWrapper): Promise<OfflineDbInfo> {
    const get = async (key: string) => (await SettingsRepository.getByKey(db, key))?.value ?? null
    const autoUpdate = await get('offlineDbAutoUpdateEnabled')
    const lastStatus = (await get('offlineDbLastStatus')) as OfflineDbInfo['lastStatus'] | null
    const entryCount = Number((await get('offlineDbEntryCount')) ?? this.malToEntry.size) || 0
    return {
      totalMapped: this.malToEntry.size,
      totalMalMapped: this.malToEntry.size,
      isInitialized: this.isInitialized,
      isRefreshing: this.isRefreshing,
      autoUpdateEnabled: autoUpdate ? autoUpdate !== 'false' : true,
      lastCheckedAt: await get('offlineDbLastCheckedAt'),
      lastUpdatedAt: await get('offlineDbLastUpdatedAt'),
      lastStatus: lastStatus || (this.isRefreshing ? 'updating' : 'idle'),
      lastMessage: await get('offlineDbLastMessage'),
      sourceUrl: await get('offlineDbSourceUrl'),
      releaseTag: await get('offlineDbReleaseTag'),
      contentSha256: await get('offlineDbContentSha256'),
      entryCount,
      schemaVersion: SCHEMA_VERSION,
      nextDueAt: latestSaturdayUtc().toISOString(),
    }
  }

  async checkWeeklyUpdateDue(db: DatabaseWrapper): Promise<boolean> {
    const autoUpdate = await SettingsRepository.getByKey(db, 'offlineDbAutoUpdateEnabled')
    if (autoUpdate && autoUpdate.value === 'false') return false
    const lastChecked = await SettingsRepository.getByKey(db, 'offlineDbLastCheckedAt')
    if (!lastChecked?.value) return true
    const lastCheckedTime = new Date(lastChecked.value).getTime()
    if (Number.isNaN(lastCheckedTime)) return true
    return lastCheckedTime < latestSaturdayUtc().getTime()
  }

  private async interruptedRetryDue(db: DatabaseWrapper): Promise<boolean> {
    const lastChecked = await SettingsRepository.getByKey(db, 'offlineDbLastCheckedAt')
    if (!lastChecked?.value) return true
    const lastCheckedTime = new Date(lastChecked.value).getTime()
    if (Number.isNaN(lastCheckedTime)) return true
    return Date.now() - lastCheckedTime > INTERRUPTED_RETRY_COOLDOWN_MS
  }

  async executeScheduledUpdate(db: DatabaseWrapper): Promise<void> {
    if (this.isRefreshing) {
      log.info('Scheduled offline database update skipped: refresh already in progress')
      return
    }
    log.info('Starting scheduled weekly offline database update...')
    const result = await this.refreshDatabase(db)
    if (result.success)
      log.info(`Scheduled offline database update succeeded: ${result.count} entries`)
    else log.warn(`Scheduled offline database update failed: ${result.error}`)
  }

  async refreshDatabase(
    db: DatabaseWrapper
  ): Promise<{ success: boolean; count: number; error?: string }> {
    if (this.isRefreshing) {
      return { success: false, count: this.malToEntry.size, error: 'Refresh already in progress' }
    }
    this.isRefreshing = true
    const startedAt = Date.now()
    await SettingsRepository.upsert(db, 'offlineDbLastStatus', 'updating')
    await SettingsRepository.upsert(db, 'offlineDbLastCheckedAt', new Date().toISOString())
    await SettingsRepository.upsert(
      db,
      'offlineDbLastMessage',
      'Downloading and parsing database...'
    )

    try {
      const storedSha = (await SettingsRepository.getByKey(db, 'offlineDbContentSha256'))?.value
      const { entries, sha256, sourceUrl } = await downloadOfflineDb()
      log.info(`Parsing ${entries.length} entries from anime-offline-database...`)
      log.info(`Saving ${entries.length} mapped entries to SQLite...`)
      await storeEntries(db, entries)

      this.loadCache(db)
      this.backfillShowsMetaGenres(db)

      const releaseTag = sourceUrl.includes('/releases/') ? 'latest' : 'raw'
      await SettingsRepository.upsert(db, 'offlineDbLastStatus', 'success')
      await SettingsRepository.upsert(db, 'offlineDbLastUpdatedAt', new Date().toISOString())
      await SettingsRepository.upsert(db, 'offlineDbSourceUrl', sourceUrl)
      await SettingsRepository.upsert(db, 'offlineDbReleaseTag', releaseTag)
      await SettingsRepository.upsert(db, 'offlineDbContentSha256', sha256)
      await SettingsRepository.upsert(db, 'offlineDbEntryCount', String(entries.length))
      const skipped = storedSha === sha256
      await SettingsRepository.upsert(
        db,
        'offlineDbLastMessage',
        `Updated ${entries.length} entries in ${Math.round((Date.now() - startedAt) / 1000)}s${skipped ? ' (unchanged upstream hash)' : ''}.`
      )
      log.info(`OfflineDb refresh completed: ${entries.length} entries from ${sourceUrl}`)
      return { success: true, count: entries.length }
    } catch (err) {
      const errMsg = (err as Error).message || 'Failed to refresh offline database'
      log.error({ err }, 'Failed to refresh anime-offline-database')
      await SettingsRepository.upsert(db, 'offlineDbLastStatus', 'failed')
      await SettingsRepository.upsert(db, 'offlineDbLastMessage', errMsg)
      return { success: false, count: this.malToEntry.size, error: errMsg }
    } finally {
      this.isRefreshing = false
    }
  }
}

export const offlineDb = new OfflineDb()
export type { OfflineDbInfo, OfflineEntry }
