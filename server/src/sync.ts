import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import logger from './logger.js'
import { googleDriveService } from './google.js'
import { rcloneService } from './rclone.js'
import { githubSyncService } from './github-sync.js'
import { CONFIG } from './config.js'
import { DatabaseWrapper } from './db.js'
import { getLocalManifestVersion, setLocalManifestVersion } from './db/transaction.js'
import { dbGet } from './utils/db-utils.js'
import { notifySyncStart, notifySyncEnd } from './lib/ipc.js'
import {
  ANIME_SYNC_TABLES,
  exportTables,
  importTables,
  MANGA_SYNC_TABLES,
  TV_SYNC_TABLES,
  ASMR_SYNC_TABLES,
  normalizePayload,
  readPayloadVersion,
  type SyncPayload,
} from './sync-payload.js'

const log = logger.child({ module: 'Sync' })

export const SYNC_TABLES = ANIME_SYNC_TABLES
export { MANGA_SYNC_TABLES, TV_SYNC_TABLES, ASMR_SYNC_TABLES }

export type SyncTable = (typeof SYNC_TABLES)[number]
export type AnimeSyncPayload = SyncPayload<SyncTable>

export type MediaKind = 'anime' | 'manga' | 'tv' | 'asmr'

export interface KindSyncDef {
  mid: '' | 'manga ' | 'TV ' | 'ASMR '
  Head: '' | 'Manga ' | 'TV ' | 'ASMR '
  rcloneLabel: string
  tables: readonly string[]
  libraryTables: readonly string[]
  backupName: string
  manifestPath: string
  rcloneFile: string
  githubDown: (db: DatabaseWrapper) => Promise<number>
  githubUp: (db: DatabaseWrapper) => Promise<void>
  googleDown: (db: DatabaseWrapper) => Promise<number>
  googleUp: (db: DatabaseWrapper) => Promise<void>
  githubVersion: () => Promise<number>
  googleVersion: () => Promise<number>
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

export const KIND_SYNC: Record<MediaKind, KindSyncDef> = {
  anime: {
    mid: '',
    Head: '',
    rcloneLabel: 'rclone',
    tables: SYNC_TABLES,
    libraryTables: ['watchlist', 'watched_episodes'],
    backupName: 'pre-sync-backup.db',
    manifestPath: CONFIG.LOCAL_MANIFEST_PATH,
    rcloneFile: CONFIG.RCLONE_SYNC_FILENAME,
    githubDown: (db) => githubSyncService.syncDown(db),
    githubUp: (db) => githubSyncService.syncUp(db),
    googleDown: (db) => googleDriveService.syncDown(db),
    githubVersion: () => githubSyncService.getRemoteVersion(),
    googleVersion: () => googleDriveService.getRemoteVersion(),
    googleUp: (db) => googleDriveService.syncUp(db),
  },
  manga: {
    mid: 'manga ',
    Head: 'Manga ',
    rcloneLabel: 'rclone manga',
    tables: MANGA_SYNC_TABLES,
    libraryTables: ['manga_library', 'manga_progress'],
    backupName: 'pre-sync-manga-backup.db',
    manifestPath: CONFIG.MANGA_LOCAL_MANIFEST_PATH,
    rcloneFile: CONFIG.MANGA_RCLONE_SYNC_FILENAME,
    githubDown: (db) => githubSyncService.syncMangaDown(db),
    githubUp: (db) => githubSyncService.syncMangaUp(db),
    googleDown: (db) => googleDriveService.syncMangaDown(db),
    githubVersion: () => githubSyncService.getMangaRemoteVersion(),
    googleVersion: () => googleDriveService.getMangaRemoteVersion(),
    googleUp: (db) => googleDriveService.syncMangaUp(db),
  },
  tv: {
    mid: 'TV ',
    Head: 'TV ',
    rcloneLabel: 'rclone tv',
    tables: TV_SYNC_TABLES,
    libraryTables: ['tv_library', 'tv_progress'],
    backupName: 'pre-sync-tv-backup.db',
    manifestPath: CONFIG.TV_LOCAL_MANIFEST_PATH,
    rcloneFile: CONFIG.TV_RCLONE_SYNC_FILENAME,
    githubDown: (db) => githubSyncService.syncTvDown(db),
    githubUp: (db) => githubSyncService.syncTvUp(db),
    googleDown: (db) => googleDriveService.syncTvDown(db),
    githubVersion: () => githubSyncService.getTvRemoteVersion(),
    googleVersion: () => googleDriveService.getTvRemoteVersion(),
    googleUp: (db) => googleDriveService.syncTvUp(db),
  },
  asmr: {
    mid: 'ASMR ',
    Head: 'ASMR ',
    rcloneLabel: 'rclone asmr',
    tables: ASMR_SYNC_TABLES,
    libraryTables: ['asmr_library', 'asmr_progress'],
    backupName: 'pre-sync-asmr-backup.db',
    manifestPath: CONFIG.ASMR_LOCAL_MANIFEST_PATH,
    rcloneFile: CONFIG.ASMR_RCLONE_SYNC_FILENAME,
    githubDown: (db) => githubSyncService.syncAsmrDown(db),
    githubUp: (db) => githubSyncService.syncAsmrUp(db),
    googleDown: (db) => googleDriveService.syncAsmrDown(db),
    githubVersion: () => githubSyncService.getAsmrRemoteVersion(),
    googleVersion: () => googleDriveService.getAsmrRemoteVersion(),
    googleUp: (db) => googleDriveService.syncAsmrUp(db),
  },
}

async function getRcloneRemotePayloadVersion(
  remoteFolder: string,
  fileName: string = CONFIG.RCLONE_SYNC_FILENAME
): Promise<number> {
  const exists = await rcloneService.fileExists(remoteFolder, fileName)
  if (!exists) return 0
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_sync.json`)
  try {
    await rcloneService.downloadFile(remoteFolder, fileName, tempPath)
    const content = await fs.readFile(tempPath, 'utf-8')
    const payload = JSON.parse(content) as AnimeSyncPayload
    return readPayloadVersion(payload)
  } catch {
    return 0
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath)
  }
}

async function rcloneSyncUp(
  db: DatabaseWrapper,
  kind: MediaKind,
  remoteFolder: string
): Promise<void> {
  const def = KIND_SYNC[kind]
  const payload = exportTables(db, def.tables)
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_${kind}_up.json`)
  try {
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2))
    await rcloneService.uploadFile(tempPath, remoteFolder, def.rcloneFile)
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => {})
  }
}

async function rcloneSyncDown(
  db: DatabaseWrapper,
  kind: MediaKind,
  remoteFolder: string
): Promise<number> {
  const def = KIND_SYNC[kind]
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_${kind}_down.json`)
  try {
    await rcloneService.downloadFile(remoteFolder, def.rcloneFile, tempPath)
    const content = await fs.readFile(tempPath, 'utf-8')
    const payload = normalizePayload(JSON.parse(content), def.tables, def.rcloneLabel)
    importTables(db, def.tables, payload, {
      libraryTables: def.libraryTables,
      backupName: def.backupName,
    })
    return readPayloadVersion(payload)
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => {})
  }
}

class Mutex {
  private _locked = false
  private _waiting: (() => void)[] = []

  async lock() {
    return new Promise<void>((resolve) => {
      if (!this._locked) {
        this._locked = true
        resolve()
      } else {
        this._waiting.push(resolve)
      }
    })
  }

  unlock() {
    const resolve = this._waiting.shift()
    if (resolve) resolve()
    else this._locked = false
  }
}

const syncMutexes: Record<MediaKind, Mutex> = {
  anime: new Mutex(),
  manga: new Mutex(),
  tv: new Mutex(),
  asmr: new Mutex(),
}
const isSyncingMap: Record<MediaKind, boolean> = {
  anime: false,
  manga: false,
  tv: false,
  asmr: false,
}
let activeProvider: 'github' | 'google' | 'rclone' | 'none' = 'none'

export async function waitForSync(): Promise<void> {
  await Promise.all(
    (Object.values(syncMutexes) as Mutex[]).map(async (m) => {
      await m.lock()
      m.unlock()
    })
  )
}

export function getActiveProvider() {
  return activeProvider
}

export async function initSyncProvider(
  preferred?: 'github' | 'google' | 'rclone' | 'none'
): Promise<void> {
  const provider =
    preferred || (process.env.SYNC_PROVIDER as 'github' | 'google' | 'rclone' | 'none' | undefined)

  if (provider === 'github' && githubSyncService.isAuthenticated()) {
    activeProvider = 'github'
    log.info('Sync Provider: GitHub (Selected)')
    return
  }

  if (provider === 'google' && googleDriveService.isAuthenticated()) {
    activeProvider = 'google'
    log.info('Sync Provider: Google Drive API (Selected)')
    return
  }

  if (provider === 'rclone') {
    const rcloneAvailable = await rcloneService.init()
    if (rcloneAvailable) {
      activeProvider = 'rclone'
      log.info(`Sync Provider: Rclone (${rcloneService.getRemoteName()}) (Selected)`)
      return
    }
  }

  if (provider === 'none') {
    activeProvider = 'none'
    log.info('Sync Provider: None (Forced)')
    return
  }

  if (githubSyncService.isAuthenticated()) {
    activeProvider = 'github'
    log.info('Sync Provider: GitHub (Fallback)')
    return
  }

  if (googleDriveService.isAuthenticated()) {
    activeProvider = 'google'
    log.info('Sync Provider: Google Drive API (Fallback)')
    return
  }

  const rcloneAvailable = await rcloneService.init()
  if (rcloneAvailable) {
    activeProvider = 'rclone'
    log.info(`Sync Provider: Rclone (${rcloneService.getRemoteName()}) (Fallback)`)
    return
  }

  activeProvider = 'none'
  log.info('No sync provider available.')
}

export function getKindManifestVersion(kind: MediaKind): Promise<number> {
  return getLocalManifestVersion(KIND_SYNC[kind].manifestPath)
}

export function setKindManifestVersion(kind: MediaKind, version: number): Promise<void> {
  return setLocalManifestVersion(version, KIND_SYNC[kind].manifestPath)
}

async function getRemoteManifestVersion(
  remoteFolder: string,
  kind: MediaKind = 'anime'
): Promise<{ version: number; fileId?: string }> {
  const def = KIND_SYNC[kind]
  const label = kind === 'anime' ? 'manifest' : `${def.mid.trim()} manifest`
  try {
    if (activeProvider === 'github') {
      if (!githubSyncService.isAuthenticated()) return { version: 0 }
      return { version: await def.githubVersion() }
    } else if (activeProvider === 'google') {
      if (!googleDriveService.isAuthenticated()) return { version: 0 }
      return { version: await def.googleVersion() }
    } else if (activeProvider === 'rclone') {
      return { version: await getRcloneRemotePayloadVersion(remoteFolder, def.rcloneFile) }
    }
  } catch (err) {
    log.warn({ err }, `Could not read remote ${label}.`)
  }
  return { version: 0 }
}

export async function syncDownOnBoot(
  db: DatabaseWrapper,
  kind: MediaKind,
  remoteFolderName: string
): Promise<number> {
  const def = KIND_SYNC[kind]
  let localVersion = await getKindManifestVersion(kind)

  if (localVersion === 0 && db) {
    const row = dbGet<{ value: number }>(
      db,
      "SELECT value FROM sync_metadata WHERE key = 'db_version'"
    )
    localVersion = row?.value ?? 0
    if (localVersion > 0) {
      await setKindManifestVersion(kind, localVersion)
    }
  }

  if (activeProvider === 'none') return -1

  const mutex = syncMutexes[kind]
  await mutex.lock()
  if (isSyncingMap[kind]) {
    mutex.unlock()
    return -1
  }
  isSyncingMap[kind] = true

  try {
    notifySyncStart(`Initial ${def.mid}sync check (${activeProvider})`)
    const { version: remoteVersion } = await getRemoteManifestVersion(remoteFolderName, kind)
    notifySyncEnd()

    log.info(`${def.Head}Sync Check: Local v${localVersion} vs Remote v${remoteVersion}`)

    if (remoteVersion > localVersion) {
      if (activeProvider === 'github') {
        if (!githubSyncService.isAuthenticated()) return remoteVersion
        notifySyncStart(`Importing GitHub ${def.mid}sync data (Remote v${remoteVersion})`)
        const importedVersion = await def.githubDown(db)
        await setKindManifestVersion(kind, importedVersion || remoteVersion)
        notifySyncEnd()
        log.info(`GitHub ${def.mid}sync down complete.`)
        return remoteVersion
      }

      if (activeProvider === 'google') {
        if (!googleDriveService.isAuthenticated()) return remoteVersion
        notifySyncStart(`Importing Google ${def.mid}sync data (Remote v${remoteVersion})`)
        const importedVersion = await def.googleDown(db)
        await setKindManifestVersion(kind, importedVersion || remoteVersion)
        notifySyncEnd()
        log.info(`Google ${def.mid}sync down complete.`)
        return remoteVersion
      }

      if (activeProvider === 'rclone') {
        notifySyncStart(`Importing Rclone ${def.mid}sync data (Remote v${remoteVersion})`)
        const importedVersion = await rcloneSyncDown(db, kind, remoteFolderName)
        await setKindManifestVersion(kind, importedVersion || remoteVersion)
        notifySyncEnd()
        log.info(`Rclone ${def.mid}sync down complete.`)
        return remoteVersion
      }
    } else {
      log.info(`Local ${def.mid}DB is up to date.`)
    }
    return remoteVersion
  } catch (err) {
    notifySyncEnd()
    log.error({ err }, `${cap(`${def.mid}sync`)} boot error.`)
    return -1
  } finally {
    isSyncingMap[kind] = false
    mutex.unlock()
  }
}

export async function syncUp(
  db: DatabaseWrapper,
  kind: MediaKind,
  remoteFolderName: string,
  knownRemoteVersion?: number
): Promise<void> {
  const def = KIND_SYNC[kind]
  if (activeProvider === 'none') return

  const mutex = syncMutexes[kind]
  await mutex.lock()
  if (isSyncingMap[kind]) {
    mutex.unlock()
    return
  }
  isSyncingMap[kind] = true

  try {
    const localVersion = await getKindManifestVersion(kind)
    const remoteVersion =
      knownRemoteVersion !== undefined && knownRemoteVersion >= 0
        ? knownRemoteVersion
        : (await getRemoteManifestVersion(remoteFolderName, kind)).version

    if (localVersion > remoteVersion) {
      notifySyncStart(`Syncing ${def.mid}up (Local v${localVersion})`)
      if (activeProvider === 'github') {
        if (!githubSyncService.isAuthenticated()) return
        await def.githubUp(db)
      } else if (activeProvider === 'google') {
        if (!googleDriveService.isAuthenticated()) return
        await def.googleUp(db)
      } else if (activeProvider === 'rclone') {
        await rcloneSyncUp(db, kind, remoteFolderName)
      }

      notifySyncEnd()
      log.info(`${cap(`${def.mid}sync`)} up complete.`)
    } else {
      log.info(`No ${def.mid}changes to sync up or remote is newer.`)
    }
  } catch (err) {
    notifySyncEnd()
    log.error({ err }, `${cap(`${def.mid}sync`)} up failed.`)
  } finally {
    isSyncingMap[kind] = false
    mutex.unlock()
  }
}

export async function runFullSyncSequence(
  dbs: {
    db: DatabaseWrapper
    mangaDb: DatabaseWrapper
    tvDb: DatabaseWrapper
    asmrDb: DatabaseWrapper
  },
  opts: {
    remoteFolder: string
    preferredProvider?: 'github' | 'google' | 'rclone' | 'none'
  }
): Promise<void> {
  await initSyncProvider(opts.preferredProvider)

  if (getActiveProvider() === 'github' && githubSyncService.isAuthenticated()) {
    try {
      await githubSyncService.migrateFromAniWebSync()
    } catch (err) {
      logger.error({ err }, 'GitHub sync migration from ani-web failed')
    }
  }

  // Anime runs first and sequentially - it may sync down data
  const animeRemoteVersion = await syncDownOnBoot(dbs.db, 'anime', opts.remoteFolder).catch(
    (err) => {
      logger.error({ err }, 'Sync down on boot failed')
      return -1 as number
    }
  )
  await syncUp(dbs.db, 'anime', opts.remoteFolder, animeRemoteVersion).catch((err) =>
    logger.error({ err }, 'Sync up on boot failed')
  )

  // manga / TV / ASMR are independent - check + up in parallel
  const secondary: { kind: MediaKind; db: DatabaseWrapper }[] = [
    { kind: 'manga', db: dbs.mangaDb },
    { kind: 'tv', db: dbs.tvDb },
    { kind: 'asmr', db: dbs.asmrDb },
  ]
  await Promise.allSettled(
    secondary.map(async ({ kind, db }) => {
      const def = KIND_SYNC[kind]
      const remoteVersion = await syncDownOnBoot(db, kind, opts.remoteFolder).catch((err) => {
        logger.error({ err }, `${def.Head}sync down on boot failed`)
        return -1 as number
      })
      await syncUp(db, kind, opts.remoteFolder, remoteVersion).catch((err) =>
        logger.error({ err }, `${def.Head}sync up on boot failed`)
      )
    })
  )
}
