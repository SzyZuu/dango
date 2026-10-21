import { buildAnilistMangaId, buildSyntheticChapterId, mangaStatusOrFallback } from './resolve.js'
import { MANGA_PROVIDER, MANGA_SYNC_STATE_KEY, TOKEN_KEY } from './resolve.js'
import { AniListTracker } from '../anilist-tracker.js'
import type { RemoteMangaEntry } from '../anilist-tracker.js'
import {
  MangaLibraryRepository,
  MangaProgressRepository,
} from '../../../repositories/manga.repository.js'
import { SettingsRepository } from '../../../repositories/settings.repository.js'
import {
  performMangaWriteTransactionAsync,
  performWriteTransactionAsync,
} from '../../../db/transaction.js'
import { DatabaseWrapper } from '../../../db.js'
import logger from '../../../logger.js'
import {
  searchAnilistMangaByTitle,
  getMangaMetaById,
  getMangaMetaByMalId,
} from '../../anilist/index.js'
import { fetchMalMangaList, mapMalMangaStatusCode } from '../../mal/index.js'
import { readTrackerSyncState } from '../sync-state.js'

export interface MangaImportItem {
  mediaId: number
  title: string
  cover?: string
  status: string
  progress: number
  remoteUpdatedAt?: number
}

function mangaImportStatusOrDefault(status: string): string {
  return mangaStatusOrFallback(status) ?? 'Planned'
}

export async function insertMangaImportEntries(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  items: MangaImportItem[],
  eraseAnilistRows: boolean
): Promise<number> {
  if (items.length === 0) return 0

  const now = Math.floor(Date.now() / 1000)
  const syncState = await readTrackerSyncState(db, MANGA_SYNC_STATE_KEY)

  await performMangaWriteTransactionAsync(mangaDb, async (tx) => {
    if (eraseAnilistRows) {
      for (const row of await MangaLibraryRepository.getAll(tx)) {
        if (String(row.provider).toLowerCase() === MANGA_PROVIDER) {
          await MangaLibraryRepository.delete(tx, row.id)
          await MangaProgressRepository.deleteByKey(tx, row.id)
        }
      }
    }
    for (const item of items) {
      const id = buildAnilistMangaId(item.mediaId)
      const status = mangaImportStatusOrDefault(item.status)
      await MangaLibraryRepository.upsert(tx, {
        id,
        provider: MANGA_PROVIDER,
        mangaId: String(item.mediaId),
        title: item.title,
        cover: item.cover ?? '',
        status,
        anilistId: item.mediaId,
        anilistIdSource: 'anilist',
      })
      if (item.progress > 0) {
        await MangaLibraryRepository.setProgressPointer(tx, id, String(item.progress))
        const chapterId = buildSyntheticChapterId(item.progress)
        await MangaProgressRepository.deleteSyntheticChapters(tx, id, chapterId)
        await MangaProgressRepository.upsert(tx, {
          mangaId: id,
          chapterId,
          chapterNumber: String(item.progress),
          page: 0,
          pageCount: 0,
          title: item.title,
          cover: item.cover ?? '',
          provider: MANGA_PROVIDER,
        })
      }
      syncState[String(item.mediaId)] = {
        lastSyncedAt: now,
        remoteUpdatedAt: item.remoteUpdatedAt ?? now,
      }
    }
  })

  try {
    const snapshot = JSON.stringify(syncState)
    await performWriteTransactionAsync(db, async (tx) => {
      await SettingsRepository.upsert(tx, MANGA_SYNC_STATE_KEY, snapshot)
    })
  } catch (err) {
    logger.warn({ err }, '[AniList Manga Sync] Failed to persist sync state after import')
  }

  return items.length
}

export async function importFromUsernameManga(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  username: string,
  erase = false
): Promise<number> {
  const tokenRow = await SettingsRepository.getByKey(db, TOKEN_KEY)
  const token = tokenRow?.value

  const tracker = new AniListTracker(token)
  let entries: RemoteMangaEntry[]

  if (token) {
    const viewer = await tracker.getViewer()
    entries = await tracker.fetchUserMangaList(viewer.id)
  } else {
    entries = await tracker.fetchUserMangaList(username)
  }

  if (entries.length === 0) return 0

  return insertMangaImportEntries(
    db,
    mangaDb,
    entries.map((remote) => ({
      mediaId: remote.mediaId,
      title: remote.title.english || remote.title.romaji || `Manga #${remote.mediaId}`,
      cover: remote.coverImage,
      status: remote.status,
      progress: remote.progress,
      remoteUpdatedAt: remote.updatedAt,
    })),
    erase
  )
}

async function resolveMalMangaToAnilist(
  malId: number,
  title: string,
  titleEnglish: string | null
): Promise<{ id: number; title: string; cover?: string } | null> {
  if (malId) {
    try {
      const byMal = await getMangaMetaByMalId(malId)
      if (byMal) {
        return {
          id: byMal.id,
          title: byMal.title.english || byMal.title.romaji || title,
          cover: byMal.cover,
        }
      }
    } catch {
      // ignore
    }
  }
  const query = titleEnglish || title
  if (!query) return null
  try {
    const found = await searchAnilistMangaByTitle(query)
    if (!found) return null
    const meta = await getMangaMetaById(found.id)
    return {
      id: found.id,
      title:
        meta?.title.english ||
        meta?.title.romaji ||
        found.title.english ||
        found.title.romaji ||
        query,
      cover: meta?.cover,
    }
  } catch {
    return null
  }
}

export interface MalMangaImportResult {
  imported: number
  skipped: number
}

export async function importMangaFromMalUsername(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  username: string,
  erase = false
): Promise<MalMangaImportResult> {
  const entries = await fetchMalMangaList(username)
  if (entries.length === 0) return { imported: 0, skipped: 0 }

  const items: MangaImportItem[] = []
  let skipped = 0
  const BATCH_SIZE = 5
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((e) => resolveMalMangaToAnilist(e.malId, e.title, e.titleEnglish))
    )
    results.forEach((r, idx) => {
      const entry = batch[idx]
      const status = mapMalMangaStatusCode(entry.status)
      if (r.status !== 'fulfilled' || !r.value || !status) {
        skipped++
        return
      }
      items.push({
        mediaId: r.value.id,
        title: r.value.title,
        cover: r.value.cover,
        status,
        progress: Math.max(entry.chaptersRead, 0),
      })
    })
  }

  const imported = await insertMangaImportEntries(db, mangaDb, items, erase)
  return { imported, skipped }
}

export interface MalXmlMangaItem {
  malId: number
  title: string
  status: string
  chapters: number
}

export async function importMangaFromMalXmlItems(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  list: MalXmlMangaItem[],
  erase = false
): Promise<MalMangaImportResult> {
  if (list.length === 0) return { imported: 0, skipped: 0 }

  const items: MangaImportItem[] = []
  let skipped = 0
  const BATCH_SIZE = 5
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((e) => resolveMalMangaToAnilist(e.malId, e.title, null))
    )
    results.forEach((r, idx) => {
      const entry = batch[idx]
      if (r.status !== 'fulfilled' || !r.value) {
        skipped++
        return
      }
      items.push({
        mediaId: r.value.id,
        title: r.value.title,
        cover: r.value.cover,
        status: entry.status,
        progress: Math.max(entry.chapters, 0),
      })
    })
  }

  const imported = await insertMangaImportEntries(db, mangaDb, items, erase)
  return { imported, skipped }
}
