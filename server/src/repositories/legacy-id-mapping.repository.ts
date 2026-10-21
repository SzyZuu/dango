import type { DatabaseWrapper } from '../db.js'
import { dbGet, dbRun } from '../utils/db-utils.js'

export const LegacyIdMappingRepository = {
  getNumericId(db: DatabaseWrapper, legacyId: string): string | null {
    const row = dbGet<{ numericId: string }>(
      db,
      'SELECT numericId FROM legacy_id_mapping WHERE legacyId = ?',
      [legacyId]
    )
    return row?.numericId ?? null
  },

  getLegacyId(db: DatabaseWrapper, numericId: string): string | null {
    const row = dbGet<{ legacyId: string }>(
      db,
      'SELECT legacyId FROM legacy_id_mapping WHERE numericId = ? AND legacyId IN (SELECT id FROM watchlist)',
      [numericId]
    )
    return row?.legacyId ?? null
  },

  set(db: DatabaseWrapper, legacyId: string, numericId: string): void {
    dbRun(db, 'INSERT OR REPLACE INTO legacy_id_mapping (legacyId, numericId) VALUES (?, ?)', [
      legacyId,
      numericId,
    ])
  },

  setNumericId(db: DatabaseWrapper, legacyId: string, numericId: string): void {
    dbRun(db, 'UPDATE legacy_id_mapping SET numericId = ? WHERE legacyId = ?', [
      numericId,
      legacyId,
    ])
  },
}
