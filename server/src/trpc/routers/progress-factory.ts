import { protectedProcedure } from '../index.js'
import type { DatabaseWrapper } from '../../db.js'
import type { TrpcContext } from '../context.js'
import { badRequest, unavailable } from '../errors.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import type { ProgressRepo } from '../../repositories/progress.repository.js'
import { defineSchema, readIds, readLimit, reqObj, type Schema } from '../validation.js'

export type ProgressRouterConfig<
  ProgressRow,
  ContinueRow extends { watchlistStatus?: string | null },
  ByIn,
  RemoveIn,
> = {
  db: (ctx: TrpcContext) => DatabaseWrapper
  write: (db: DatabaseWrapper, runnable: (tx: DatabaseWrapper) => Promise<void>) => Promise<void>
  repo: ProgressRepo<ProgressRow>
  keyField: string
  byKeyInput: Schema<ByIn, ByIn>
  removeInput: Schema<RemoveIn, RemoveIn>
  removeOne?: (db: DatabaseWrapper, key: string, input: RemoveIn) => boolean
  continueRows: (db: DatabaseWrapper, limit: number) => ContinueRow[] | Promise<ContinueRow[]>
  continueSettings: { ignoreAdult: string; listOnly: string }
  isAdult: (row: ContinueRow) => boolean
  watchlistStatus: string
  adultIds: (db: DatabaseWrapper) => string[] | Promise<string[]>
  normalizeKey?: (key: string) => string
}

const removeManyInput = () =>
  defineSchema<string[] | { ids: string[] }, string[]>((value) => readIds(value))

const continueInput = () =>
  defineSchema<{ limit: number }, { limit: number }>((value) => ({
    limit: readLimit(reqObj(value), 24, 100),
  }))

export function createProgressRouter<
  ProgressRow,
  ContinueRow extends { watchlistStatus?: string | null },
  ByIn,
  RemoveIn,
>(config: ProgressRouterConfig<ProgressRow, ContinueRow, ByIn, RemoveIn>) {
  const { repo } = config

  const kindDb = (ctx: TrpcContext): DatabaseWrapper => {
    const db = config.db(ctx)
    if (!db || db.isClosedCheck()) {
      throw unavailable('database is not ready')
    }
    return db
  }

  const readKey = (input: unknown): string => {
    const raw = (input as Record<string, unknown>)[config.keyField]
    const key = String(raw ?? '').trim()
    if (!key) {
      throw badRequest(`${config.keyField} is required`)
    }
    return config.normalizeKey ? config.normalizeKey(key) : key
  }

  return {
    byKey: protectedProcedure.input(config.byKeyInput).query(async ({ ctx, input }) => {
      const rows = await repo.getByKey(kindDb(ctx), readKey(input))
      return { progress: rows }
    }),

    remove: protectedProcedure.input(config.removeInput).mutation(async ({ ctx, input }) => {
      const value = input as RemoveIn
      const key = readKey(value)
      await config.write(kindDb(ctx), async (tx) => {
        if (!config.removeOne || !config.removeOne(tx, key, value)) {
          await repo.deleteByKey(tx, key)
        }
      })
      return { success: true }
    }),

    removeMany: protectedProcedure.input(removeManyInput()).mutation(async ({ ctx, input }) => {
      const ids = input.map((id) =>
        config.normalizeKey ? config.normalizeKey(String(id)) : String(id)
      )
      await config.write(kindDb(ctx), async (tx) => {
        await repo.deleteMany(tx, ids)
      })
      return { success: true, removed: ids.length }
    }),

    continue: protectedProcedure.input(continueInput()).query(async ({ ctx, input }) => {
      const limit = input.limit
      const { ignoreAdult, listOnly } = await SettingsRepository.readContinueFlags(
        ctx.db,
        config.continueSettings.ignoreAdult,
        config.continueSettings.listOnly
      )
      const rows = (await config.continueRows(kindDb(ctx), limit)).filter((row) => {
        if (ignoreAdult && config.isAdult(row)) return false
        if (listOnly && row.watchlistStatus !== config.watchlistStatus) return false
        return true
      })
      return { data: rows, total: rows.length }
    }),

    adultCount: protectedProcedure.query(async ({ ctx }) => {
      const ids = await config.adultIds(kindDb(ctx))
      return { count: ids.length }
    }),

    purgeAdult: protectedProcedure.mutation(async ({ ctx }) => {
      const ids = await config.adultIds(kindDb(ctx))
      if (ids.length > 0) {
        await config.write(kindDb(ctx), async (tx) => {
          await repo.deleteMany(tx, ids)
        })
      }
      return { success: true, removed: ids.length }
    }),
  }
}
