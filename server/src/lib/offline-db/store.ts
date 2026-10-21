import type { DatabaseWrapper } from '../../db.js'
import logger from '../../logger.js'
import type { OfflineEntry } from './types.js'

const log = logger.child({ module: 'OfflineDb' })

export const SCHEMA_VERSION = 1
export const TABLE = 'anime_id_map'
export const STAGING_TABLE = 'anime_id_map_new'
const CHUNK_SIZE = 1000

export function ensureTable(db: DatabaseWrapper, table: string = TABLE): void {
  const row = db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [table]
  )
  if (!row) {
    db.run(
      `CREATE TABLE ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT, anilist_id INTEGER, mal_id INTEGER, title TEXT, thumbnail TEXT, type TEXT, genres TEXT)`
    )
  } else {
    const columns = db.all<{ name: string }>(`PRAGMA table_info(${table})`)
    const names = new Set(columns.map((c) => c.name))
    if (!names.has('mal_id')) db.run(`ALTER TABLE ${table} ADD COLUMN mal_id INTEGER`)
    if (!names.has('type')) db.run(`ALTER TABLE ${table} ADD COLUMN type TEXT`)
    if (!names.has('genres')) db.run(`ALTER TABLE ${table} ADD COLUMN genres TEXT`)
  }
  db.run(`CREATE INDEX IF NOT EXISTS idx_anime_id_map_anilist ON ${table}(anilist_id)`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_anime_id_map_mal ON ${table}(mal_id)`)
}

export function loadEntries(db: DatabaseWrapper): OfflineEntry[] {
  ensureTable(db)
  const rows = db.all<{
    anilist_id: number | null
    mal_id: number | null
    title: string | null
    thumbnail: string | null
    type: string | null
    genres: string | null
  }>(
    `SELECT anilist_id, mal_id, title, thumbnail, type, genres FROM ${TABLE} WHERE anilist_id IS NOT NULL AND mal_id IS NOT NULL`
  )
  const entries: OfflineEntry[] = []
  for (const row of rows) {
    if (!row.anilist_id || !row.mal_id) continue
    entries.push({
      anilistId: row.anilist_id,
      malId: row.mal_id,
      title: row.title || '',
      thumbnail: row.thumbnail || undefined,
      type: row.type || undefined,
      genres: row.genres || undefined,
    })
  }
  return entries
}

export async function storeEntries(db: DatabaseWrapper, entries: OfflineEntry[]): Promise<void> {
  db.run(`DROP TABLE IF EXISTS ${STAGING_TABLE}`)
  ensureTable(db, STAGING_TABLE)
  const stmt = db.prepare(
    `INSERT INTO ${STAGING_TABLE} (anilist_id, mal_id, title, thumbnail, type, genres) VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    const chunk = entries.slice(i, i + CHUNK_SIZE)
    db.serialize(() => {
      for (const entry of chunk) {
        stmt.run(
          entry.anilistId,
          entry.malId,
          entry.title,
          entry.thumbnail ?? null,
          entry.type ?? null,
          entry.genres ?? null
        )
      }
    })
    await new Promise((resolve) => setImmediate(resolve))
  }
  db.run(`DROP TABLE IF EXISTS ${TABLE}`)
  db.run(`ALTER TABLE ${STAGING_TABLE} RENAME TO ${TABLE}`)
  ensureTable(db)
}

export function backfillShowsMetaGenres(db: DatabaseWrapper): number {
  try {
    ensureTable(db)
    db.run(`
        UPDATE shows_meta
        SET genres = (
          SELECT genres FROM ${TABLE}
          WHERE anilist_id = CAST(shows_meta.id AS INTEGER)
            AND genres IS NOT NULL AND genres != '[]'
          LIMIT 1
        )
        WHERE (genres IS NULL OR genres = '' OR genres = '[]')
          AND EXISTS (
            SELECT 1 FROM ${TABLE}
            WHERE anilist_id = CAST(shows_meta.id AS INTEGER)
              AND genres IS NOT NULL AND genres != '[]'
          )
      `)
    return 1
  } catch (err) {
    log.warn({ err }, 'Failed to backfill shows_meta genres from offline db')
    return 0
  }
}

export function latestSaturdayUtc(): Date {
  const now = new Date()
  const daysSinceSaturday = (now.getUTCDay() + 1) % 7
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysSinceSaturday,
      0,
      0,
      0,
      0
    )
  )
}
