import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseWrapper } from './db.js'
import {
  initializeAsmrDatabase,
  initializeDatabase,
  initializeMangaDatabase,
  initializeTvDatabase,
} from './db/ddl.js'

// the mal cache is a separate db in the OS data root - point it at a temp file
// so the tests never open (or prune) the real one
process.env.DANGO_MAL_CACHE_PATH ??= path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'dango-mal-cache-')),
  'mal-cache.db'
)

export interface TestDb {
  db: DatabaseWrapper
  cleanup: () => void
}

export async function createTestDb(name = 'test.db'): Promise<TestDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-test-'))
  const db = await initializeDatabase(path.join(dir, name))
  return {
    db,
    cleanup: () => {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

export interface TestDbs {
  db: DatabaseWrapper
  mangaDb: DatabaseWrapper
  tvDb: DatabaseWrapper
  asmrDb: DatabaseWrapper
  cleanup: () => void
}

export async function createTestDbs(): Promise<TestDbs> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-test-'))
  const db = await initializeDatabase(path.join(dir, 'anime.db'))
  const mangaDb = await initializeMangaDatabase(path.join(dir, 'manga.db'))
  const tvDb = await initializeTvDatabase(path.join(dir, 'tv.db'))
  const asmrDb = await initializeAsmrDatabase(path.join(dir, 'asmr.db'))
  return {
    db,
    mangaDb,
    tvDb,
    asmrDb,
    cleanup: () => {
      db.close()
      mangaDb.close()
      tvDb.close()
      asmrDb.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}
