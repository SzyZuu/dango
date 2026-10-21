import type { DatabaseWrapper } from './db.js'
import {
  ANIME_SYNC_TABLES,
  ASMR_SYNC_TABLES,
  MANGA_SYNC_TABLES,
  TV_SYNC_TABLES,
} from './sync-payload.js'

export type SyncKind = 'anime' | 'manga' | 'tv' | 'asmr'

export type SyncKindConfig = {
  tables: readonly string[]
  libraryTables: readonly string[]
  backupName: string
  label: string
}

export const SYNC_KINDS: Record<SyncKind, SyncKindConfig> = {
  anime: {
    tables: ANIME_SYNC_TABLES,
    libraryTables: ['watchlist', 'watched_episodes'],
    backupName: 'pre-sync-backup.db',
    label: '',
  },
  manga: {
    tables: MANGA_SYNC_TABLES,
    libraryTables: ['manga_library', 'manga_progress'],
    backupName: 'pre-sync-manga-backup.db',
    label: 'Manga',
  },
  tv: {
    tables: TV_SYNC_TABLES,
    libraryTables: ['tv_library', 'tv_progress'],
    backupName: 'pre-sync-tv-backup.db',
    label: 'TV',
  },
  asmr: {
    tables: ASMR_SYNC_TABLES,
    libraryTables: ['asmr_library', 'asmr_progress'],
    backupName: 'pre-sync-asmr-backup.db',
    label: 'ASMR',
  },
}

export function withLabel(label: string, text: string): string {
  return label ? `${label} ${text}` : text
}

export type SyncBackendOpts = { remoteFolder: string }

export interface SyncBackend {
  name: 'github' | 'google' | 'rclone'
  label: string
  isAuthenticated(): boolean
  version(kind: SyncKind, opts: SyncBackendOpts): Promise<number>
  up(kind: SyncKind, db: DatabaseWrapper, opts: SyncBackendOpts): Promise<void>
  down(kind: SyncKind, db: DatabaseWrapper, opts: SyncBackendOpts): Promise<number>
}
