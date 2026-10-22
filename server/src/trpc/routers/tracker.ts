import { MAL_KEYS, beginMalLogin, finishMalLogin } from '../../lib/tracker/mal-tracker.js'
import { syncMyAnimeList } from '../../lib/tracker/mal-sync.service.js'
import { trackerUpdateStatus, flushEpisodeSync } from '../../lib/tracker/episode-sync.js'
import { withTrackerLock } from '../../lib/tracker/sync-lock.js'
import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import logger from '../../logger.js'
import { performWriteTransactionAsync } from '../../db/transaction.js'
import { AniListTracker } from '../../lib/tracker/anilist-tracker.js'
import {
  syncAniList,
  importFromMalUsername,
  importFromUsername,
} from '../../lib/tracker/anime-sync/index.js'
import {
  syncAniListManga,
  importFromUsernameManga,
  importMangaFromMalUsername,
} from '../../lib/tracker/manga-sync/index.js'
import { defineSchema, reqObj } from '../validation.js'
import {
  badRequest,
  failed,
  notFound,
  tooManyRequests,
  unauthorized,
  unavailable,
} from '../errors.js'

const TRACKER_TOKEN_KEY = 'tracker_anilist_token'
const TRACKER_USER_KEY = 'tracker_anilist_user'

function optBody(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  return reqObj(value)
}

export type TrackerTokenInput = { token?: unknown; code?: unknown; redirectUri?: unknown }

const trackerTokenInput = () =>
  defineSchema<TrackerTokenInput, TrackerTokenInput>((value) => {
    const obj = optBody(value)
    return { token: obj.token, code: obj.code, redirectUri: obj.redirectUri }
  })

export type TrackerSyncInput = { provider?: unknown }

const trackerSyncInput = () =>
  defineSchema<TrackerSyncInput, TrackerSyncInput>((value) => ({
    provider: optBody(value).provider,
  }))

export type TrackerUsernameInput = { username?: unknown; erase?: unknown }

const trackerUsernameInput = () =>
  defineSchema<TrackerUsernameInput, TrackerUsernameInput>((value) => {
    const obj = optBody(value)
    return { username: obj.username, erase: obj.erase }
  })

export type TrackerMalInput = {
  username?: unknown
  erase?: unknown
  useOfflineDb?: unknown
  skipFallback?: unknown
}

const trackerMalInput = () =>
  defineSchema<TrackerMalInput, TrackerMalInput>((value) => {
    const obj = optBody(value)
    return {
      username: obj.username,
      erase: obj.erase,
      useOfflineDb: obj.useOfflineDb,
      skipFallback: obj.skipFallback,
    }
  })

export type TrackerMangaSyncInput = { direction?: unknown }

const trackerMangaSyncInput = () =>
  defineSchema<TrackerMangaSyncInput, TrackerMangaSyncInput>((value) => ({
    direction: optBody(value).direction,
  }))

function mapImportError(message: string): TRPCError {
  if (message.includes('private') || message.includes('not found')) {
    return notFound(message)
  }
  if (message.includes('blocked') || message.includes('HTTP 429')) {
    return tooManyRequests(message)
  }
  return failed(message)
}

export const trackerRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    try {
      const tokenRow = await SettingsRepository.getByKey(ctx.db, TRACKER_TOKEN_KEY)
      const userRow = await SettingsRepository.getByKey(ctx.db, TRACKER_USER_KEY)
      let user: unknown = null
      if (userRow?.value) {
        try {
          user = JSON.parse(userRow.value)
        } catch (e) {
          logger.warn({ err: e }, 'The stored tracker user is not valid json')
          user = null
        }
      }
      const malTokens = await SettingsRepository.getByKey(ctx.db, MAL_KEYS.tokens)
      const malUser = await SettingsRepository.getByKey(ctx.db, MAL_KEYS.user)
      return {
        anilist: {
          connected: !!tokenRow?.value,
          user,
          updates: trackerUpdateStatus(ctx.db, 'anilist'),
        },
        mal: {
          connected: !!malTokens?.value,
          user: malUser?.value
            ? (JSON.parse(malUser.value) as { id: number; name: string; avatar?: string })
            : null,
          updates: trackerUpdateStatus(ctx.db, 'mal'),
        },
      }
    } catch {
      throw failed('Failed to read tracker status')
    }
  }),

  anilistAuth: protectedProcedure.input(trackerTokenInput()).mutation(async ({ ctx, input }) => {
    const accessToken = typeof input.token === 'string' ? input.token.trim() : ''
    if (!accessToken) {
      throw badRequest('Access token is required')
    }
    try {
      const tracker = new AniListTracker(accessToken)
      const viewer = await tracker.getViewer()
      await performWriteTransactionAsync(ctx.db, async (tx) => {
        await SettingsRepository.upsert(tx, TRACKER_TOKEN_KEY, accessToken)
        await SettingsRepository.upsert(tx, TRACKER_USER_KEY, JSON.stringify(viewer))
        tx.run("DELETE FROM tracker_updates WHERE provider = 'anilist'")
      })
      return { success: true, user: viewer }
    } catch (err) {
      throw unauthorized(err instanceof Error ? err.message : 'Authentication failed')
    }
  }),

  anilistDisconnect: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      await performWriteTransactionAsync(ctx.db, async (tx) => {
        await SettingsRepository.upsert(tx, TRACKER_TOKEN_KEY, '')
        await SettingsRepository.upsert(tx, TRACKER_USER_KEY, '')
        tx.run("DELETE FROM tracker_updates WHERE provider = 'anilist'")
      })
      return { success: true }
    } catch {
      throw failed('Failed to disconnect')
    }
  }),

  sync: protectedProcedure.input(trackerSyncInput()).mutation(async ({ ctx, input }) => {
    const { provider = 'anilist' } = input
    if (provider !== 'anilist' && provider !== 'mal') {
      throw badRequest(`Provider "${provider}" is not supported yet`)
    }
    try {
      await flushEpisodeSync(ctx.db, true)
      const summary = provider === 'mal' ? await syncMyAnimeList(ctx.db) : await syncAniList(ctx.db)
      return { success: true, summary }
    } catch (err) {
      throw failed(err instanceof Error ? err.message : 'Sync failed')
    }
  }),

  malConfig: protectedProcedure.query(async ({ ctx }) => ({
    clientId:
      (await SettingsRepository.getByKey(ctx.db, MAL_KEYS.clientId))?.value ||
      process.env.MAL_CLIENT_ID ||
      '',
    hasSecret: !!(
      (await SettingsRepository.getByKey(ctx.db, MAL_KEYS.clientSecret))?.value ||
      process.env.MAL_CLIENT_SECRET
    ),
  })),

  malSaveConfig: protectedProcedure
    .input(
      defineSchema<
        { clientId: string; clientSecret?: string },
        { clientId: string; clientSecret?: string }
      >((value) => {
        const obj = reqObj(value)
        if (typeof obj.clientId !== 'string' || !obj.clientId.trim())
          throw badRequest('MAL client ID is required')
        if (obj.clientSecret !== undefined && typeof obj.clientSecret !== 'string')
          throw badRequest('Invalid client secret')
        return {
          clientId: obj.clientId.trim(),
          clientSecret: obj.clientSecret as string | undefined,
        }
      })
    )
    .mutation(async ({ ctx, input }) => {
      await withTrackerLock(ctx.db, 'mal', () =>
        ctx.db.transact(async (tx) => {
          const old =
            (await SettingsRepository.getByKey(tx, MAL_KEYS.clientId))?.value ||
            process.env.MAL_CLIENT_ID ||
            ''
          if (old && old !== input.clientId) {
            for (const key of [
              MAL_KEYS.tokens,
              MAL_KEYS.user,
              MAL_KEYS.pending,
              MAL_KEYS.clientSecret,
            ])
              await SettingsRepository.deleteByKey(tx, key)
            tx.run("DELETE FROM tracker_updates WHERE provider = 'mal'")
          }
          await SettingsRepository.upsert(tx, MAL_KEYS.clientId, input.clientId)
          if (input.clientSecret?.trim())
            await SettingsRepository.upsert(tx, MAL_KEYS.clientSecret, input.clientSecret.trim())
        })
      )
      return { success: true }
    }),

  malLogin: protectedProcedure
    .input(
      defineSchema<{ redirectUri: string }, { redirectUri: string }>((value) => {
        const obj = reqObj(value)
        if (typeof obj.redirectUri !== 'string') throw badRequest('Redirect URI is required')
        return { redirectUri: obj.redirectUri }
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await beginMalLogin(ctx.db, input.redirectUri)
      } catch (err) {
        throw badRequest(err instanceof Error ? err.message : 'Could not start MAL login')
      }
    }),

  malAuth: protectedProcedure
    .input(
      defineSchema<{ code: string; state: string }, { code: string; state: string }>((value) => {
        const obj = reqObj(value)
        if (
          typeof obj.code !== 'string' ||
          !obj.code ||
          typeof obj.state !== 'string' ||
          !obj.state
        )
          throw badRequest('MAL authorization code and state are required')
        return { code: obj.code, state: obj.state }
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return { success: true, user: await finishMalLogin(ctx.db, input.code, input.state) }
      } catch {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message:
            'MyAnimeList login failed or expired. Check your app settings and connect again.',
        })
      }
    }),

  malDisconnect: protectedProcedure.mutation(async ({ ctx }) => {
    await withTrackerLock(ctx.db, 'mal', () =>
      ctx.db.transact(async (tx) => {
        for (const key of [
          MAL_KEYS.tokens,
          MAL_KEYS.user,
          MAL_KEYS.pending,
          'tracker_mal_sync_state',
        ])
          await SettingsRepository.deleteByKey(tx, key)
        tx.run("DELETE FROM tracker_updates WHERE provider = 'mal'")
      })
    )
    return { success: true }
  }),

  anilistImport: protectedProcedure
    .input(trackerUsernameInput())
    .mutation(async ({ ctx, input }) => {
      const { username, erase } = input
      if (!username || typeof username !== 'string') {
        throw badRequest('Username is required')
      }
      try {
        const count = await importFromUsername(ctx.db, username.trim(), erase === true)
        return { success: true, count }
      } catch (err) {
        throw failed(err instanceof Error ? err.message : 'Import failed')
      }
    }),

  malImport: protectedProcedure.input(trackerMalInput()).mutation(async ({ ctx, input }) => {
    const { username, erase, useOfflineDb, skipFallback } = input
    if (!username || typeof username !== 'string') {
      throw badRequest('MAL username is required')
    }
    try {
      const count = await importFromMalUsername(ctx.db, username.trim(), {
        erase: erase === true,
        useOfflineDb: useOfflineDb !== false,
        skipFallback: skipFallback === true,
      })
      return { success: true, count }
    } catch (err) {
      throw mapImportError(err instanceof Error ? err.message : 'Import failed')
    }
  }),

  mangaSync: protectedProcedure.input(trackerMangaSyncInput()).mutation(async ({ ctx, input }) => {
    const { direction } = input
    try {
      const mangaDb = ctx.mangaDb
      if (!mangaDb || mangaDb.isClosedCheck()) {
        throw unavailable('Manga database is not ready')
      }
      const syncDirection = direction === 'pull-only' ? 'pull-only' : 'two-way'
      const result = await syncAniListManga(ctx.db, mangaDb, {
        direction: syncDirection,
      })
      return {
        success: true,
        summary: result.summary,
        details: result.details,
        direction: syncDirection,
      }
    } catch (err) {
      if (err instanceof TRPCError) throw err
      throw failed(err instanceof Error ? err.message : 'Manga sync failed')
    }
  }),

  mangaImport: protectedProcedure.input(trackerUsernameInput()).mutation(async ({ ctx, input }) => {
    const { username, erase } = input
    if (!username || typeof username !== 'string') {
      throw badRequest('Username is required')
    }
    try {
      const mangaDb = ctx.mangaDb
      if (!mangaDb || mangaDb.isClosedCheck()) {
        throw unavailable('Manga database is not ready')
      }
      const count = await importFromUsernameManga(ctx.db, mangaDb, username.trim(), erase === true)
      return { success: true, count }
    } catch (err) {
      if (err instanceof TRPCError) throw err
      throw failed(err instanceof Error ? err.message : 'Import failed')
    }
  }),

  mangaMalImport: protectedProcedure
    .input(trackerUsernameInput())
    .mutation(async ({ ctx, input }) => {
      const { username, erase } = input
      if (!username || typeof username !== 'string') {
        throw badRequest('Username is required')
      }
      try {
        const mangaDb = ctx.mangaDb
        if (!mangaDb || mangaDb.isClosedCheck()) {
          throw unavailable('Manga database is not ready')
        }
        const result = await importMangaFromMalUsername(
          ctx.db,
          mangaDb,
          username.trim(),
          erase === true
        )
        return { success: true, ...result }
      } catch (err) {
        if (err instanceof TRPCError) throw err
        throw mapImportError(err instanceof Error ? err.message : 'Import failed')
      }
    }),
})
