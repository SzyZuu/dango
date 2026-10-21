import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { DatabaseWrapper } from '../db.js'
import { LegacyIdMappingRepository } from './legacy-id-mapping.repository.js'
import { createTestDb } from '../test-helpers.js'

let db: DatabaseWrapper
let cleanup: () => void

beforeEach(async () => {
  const t = await createTestDb()
  db = t.db
  cleanup = t.cleanup
})

afterEach(() => cleanup())

test('set and getNumericId round-trip', () => {
  LegacyIdMappingRepository.set(db, 'mal-123', '456')

  assert.equal(LegacyIdMappingRepository.getNumericId(db, 'mal-123'), '456')
  assert.equal(LegacyIdMappingRepository.getNumericId(db, 'nope'), null)
})

test('set replaces an existing mapping', () => {
  LegacyIdMappingRepository.set(db, 'mal-123', '456')
  LegacyIdMappingRepository.set(db, 'mal-123', '789')

  assert.equal(LegacyIdMappingRepository.getNumericId(db, 'mal-123'), '789')
})

test('getLegacyId only resolves aliases that are still in the watchlist', () => {
  LegacyIdMappingRepository.set(db, 'mal-123', '456')

  assert.equal(LegacyIdMappingRepository.getLegacyId(db, '456'), null)

  db.run(`INSERT INTO watchlist (id,name,thumbnail,status) VALUES ('mal-123','n','t','Watching')`)

  assert.equal(LegacyIdMappingRepository.getLegacyId(db, '456'), 'mal-123')
})

test('setNumericId repoints an existing alias', () => {
  LegacyIdMappingRepository.set(db, 'mal-123', '456')
  LegacyIdMappingRepository.setNumericId(db, 'mal-123', '789')

  assert.equal(LegacyIdMappingRepository.getNumericId(db, 'mal-123'), '789')
})
