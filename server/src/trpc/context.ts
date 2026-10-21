import type { DatabaseWrapper } from '../db.js'
import type { AppCache } from '../utils/cache.utils.js'
import type { TvProvider } from '../providers/tv.types.js'
import type { MangaProvider } from '../providers/manga/manga.types.js'
import type { JasmrApi } from '../providers/asmr/asmr.types.js'
import type { Provider } from '../providers/provider.interface.js'
import type { ProviderCatalogItem } from '../providers/remote-types.js'
import type { MalCacheStore } from '../lib/mal/index.js'
import type { discordRPCService } from '../discord-rpc.js'
import type { offlineDb } from '../lib/offline-db/index.js'
import { getTokenFromHeaders, hasAppPassword, validateLanSession } from '../app-auth.js'

export type TrpcContext = {
  db: DatabaseWrapper
  mangaDb: DatabaseWrapper
  tvDb: DatabaseWrapper
  asmrDb: DatabaseWrapper
  apiCache: AppCache
  getTvProvider: (name: string) => TvProvider | undefined
  getMangaProvider: (name: string) => MangaProvider | undefined
  getJasmr: () => JasmrApi | undefined
  getProviders: () => Record<string, Provider>
  getCatalog: () => ProviderCatalogItem[]
  discordRPC: typeof discordRPCService
  offlineDb: typeof offlineDb
  malCacheStore: () => MalCacheStore
  lanAuthed: boolean
}

export type TrpcServices = {
  discordRPC: typeof discordRPCService
  offlineDb: typeof offlineDb
  malCacheStore: () => MalCacheStore
}

export function buildTrpcContext(
  deps: {
    db: DatabaseWrapper
    mangaDb: DatabaseWrapper
    tvDb: DatabaseWrapper
    asmrDb: DatabaseWrapper
    apiCache: AppCache
    getTvProvider: (name: string) => TvProvider | undefined
    getMangaProvider: (name: string) => MangaProvider | undefined
    getJasmr: () => JasmrApi | undefined
    getProviders: () => Record<string, Provider>
    getCatalog: () => ProviderCatalogItem[]
  } & TrpcServices,
  authorization: string | undefined,
  cookie: string | undefined
): TrpcContext {
  return {
    ...deps,
    lanAuthed: !hasAppPassword() || validateLanSession(getTokenFromHeaders(authorization, cookie)),
  }
}
