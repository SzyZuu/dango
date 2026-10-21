import { protectedProcedure, router } from '../index.js'
import { defineSchema, optStr, readLimit, readPage, reqObj } from '../validation.js'
import { badRequest, failed, notFound } from '../errors.js'
import type {
  MangaContentRating,
  MangaProviderName,
  MangaProvider,
} from '../../providers/manga/manga.types.js'
import type { TrpcContext } from '../context.js'
import { cached as apiCached } from '../cache.js'
import logger from '../../logger.js'

type MangaTrendingItem = {
  id: string
  provider: string
  title: string
  description: string
  tags: string[]
  year: number | null
  status: string | null
  cover: string
}

const SAFE: MangaContentRating[] = ['safe']

function parseRatings(query: Record<string, string | undefined>): MangaContentRating[] {
  const mature = query['mature'] === '1'
  const raw = String(query['rating'] || 'safe')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is MangaContentRating =>
      ['safe', 'suggestive', 'erotica', 'pornographic'].includes(s)
    )
  if (!mature) return SAFE
  const exact = [...new Set(raw)]
  return exact.length > 0 ? exact : SAFE
}

function pick(ctx: TrpcContext, name: string): MangaProvider | undefined {
  return ctx.getMangaProvider(name.toLowerCase())
}

type MangaSearchOptions = {
  query: string
  page: number
  limit: number
  sort: string
  status: string
  type: string
  ratings: MangaContentRating[]
}

type MangaSearchResult = {
  items: {
    id: string
    title: string
    cover: string
    description?: string
    genres?: string[]
    year?: number | null
    status?: string
  }[]
  hasNext: boolean
  provider: string
}

// an empty provider means "any manga provider": the first one that answers
// with results wins, so a single provider being down does not empty the page
async function runMangaSearch(
  ctx: TrpcContext,
  provider: string,
  options: MangaSearchOptions
): Promise<MangaSearchResult> {
  const names = provider
    ? [provider]
    : ctx
        .getCatalog()
        .filter((c) => c.kind === 'manga' && c.loaded)
        .map((c) => c.id)

  for (const name of names) {
    const mangaProvider = pick(ctx, name)
    if (!mangaProvider) continue
    const result = await mangaProvider.search({
      query: options.query,
      page: options.page,
      limit: options.limit,
      sort: options.sort,
      status: options.status,
      type: options.type,
      ratings: options.ratings,
    })
    const items = (result?.items ?? []) as unknown as MangaSearchResult['items']
    if (items.length > 0 || provider) {
      return { items, hasNext: result?.hasNext ?? false, provider: name }
    }
  }

  return { items: [], hasNext: false, provider: provider || names[0] || '' }
}

type ProviderResult = { status?: number; body: unknown }

async function cached(
  ctx: TrpcContext,
  key: string,
  ttl: number | undefined,
  produce: () => Promise<ProviderResult>
): Promise<unknown> {
  const result = await apiCached(ctx, key, ttl, produce, (r) => {
    const status = r.status ?? 200
    return status >= 200 && status < 400
  })
  if (result.status !== undefined && result.status !== 200) {
    const message = (result.body as { error?: string })?.error || 'Request failed'
    if (result.status === 400) throw badRequest(message)
    if (result.status === 404) throw notFound(message)
    throw failed(message)
  }
  return result.body
}

export type MangaSearchInput = {
  provider?: string
  q?: string
  page?: number
  limit?: number
  sort?: string
  status?: string
  type?: string
  rating?: string
  mature?: string
}

const mangaSearchInput = () =>
  defineSchema<MangaSearchInput, MangaSearchInput>((value) => {
    const obj = reqObj(value)
    const out: MangaSearchInput = {}
    for (const k of ['provider', 'q', 'sort', 'status', 'type', 'rating', 'mature'] as const) {
      const v = optStr(obj, k)
      if (v !== undefined) out[k] = v
    }
    if (obj.page !== undefined) out.page = readPage(obj)
    if (obj.limit !== undefined) out.limit = readLimit(obj, 24, 50)
    return out
  })

export type MangaInfoInput = { provider?: string; id?: string; rating?: string; mature?: string }

const mangaInfoInput = () =>
  defineSchema<MangaInfoInput, MangaInfoInput>((value) => {
    const obj = reqObj(value)
    const out: MangaInfoInput = {}
    for (const k of ['provider', 'id', 'rating', 'mature'] as const) {
      const v = optStr(obj, k)
      if (v !== undefined) out[k] = v
    }
    return out
  })

export type MangaPagesInput = { provider?: string; id?: string }

const mangaPagesInput = () =>
  defineSchema<MangaPagesInput, MangaPagesInput>((value) => {
    const obj = reqObj(value)
    const out: MangaPagesInput = {}
    const provider = optStr(obj, 'provider')
    if (provider !== undefined) out.provider = provider
    const id = optStr(obj, 'id')
    if (id !== undefined) out.id = id
    return out
  })

export const mangaRouter = router({
  trending: protectedProcedure.query(async ({ ctx }) => {
    const cacheKey = 'route-manga-trending'
    const cached = ctx.apiCache.get<MangaTrendingItem[]>(cacheKey)
    if (cached) return cached
    const result = await runMangaSearch(ctx, '', {
      query: '',
      page: 1,
      limit: 6,
      sort: 'followed',
      status: '',
      type: '',
      ratings: ['safe', 'suggestive'],
    })
    const results: MangaTrendingItem[] = result.items.map((m) => ({
      id: m.id,
      provider: result.provider,
      title: m.title,
      description: typeof m.description === 'string' ? m.description : '',
      tags: Array.isArray(m.genres) ? (m.genres as string[]) : [],
      year: typeof m.year === 'number' ? m.year : null,
      status: typeof m.status === 'string' ? m.status : null,
      cover: m.cover ?? '',
    }))
    ctx.apiCache.set(cacheKey, results, 600)
    return results
  }),

  search: protectedProcedure.input(mangaSearchInput()).query(async ({ ctx, input }) => {
    const provider = input.provider || ''
    const q = input.q || ''
    const page = input.page || 1
    return cached(
      ctx,
      `route-manga-search-${provider}-${q}-${page}-${input.sort || ''}-${input.status || ''}-${input.type || ''}-${input.rating || ''}-${input.mature || ''}`,
      300,
      async () => {
        try {
          const ratings = parseRatings({ rating: input.rating, mature: input.mature })
          const rawType = input.type || ''
          const type = rawType === 'doujinshi' && input.mature !== '1' ? '' : rawType
          const result = await runMangaSearch(ctx, provider, {
            query: q,
            page,
            limit: input.limit || 24,
            sort: input.sort || 'popular',
            status: input.status || '',
            type,
            ratings,
          })
          return { body: { ...result, items: result.items ?? [] } }
        } catch (err) {
          logger.error({ err }, '[Manga] search failed')
          return { body: { items: [], hasNext: false, provider } }
        }
      }
    )
  }),

  info: protectedProcedure.input(mangaInfoInput()).query(async ({ ctx, input }) => {
    const provider = String(input.provider || '')
    const id = String(input.id || '')
    const rating = String(input.rating || '')
    const mature = String(input.mature || '')
    return cached(ctx, `route-manga-info-${provider}-${id}-${rating}-${mature}`, 600, async () => {
      try {
        if (!id) return { status: 400, body: { error: 'Missing id' } }
        const detail = await pick(ctx, provider as string as MangaProviderName)?.getDetail(
          id,
          parseRatings({ rating, mature })
        )
        if (!detail) return { status: 404, body: { error: 'Not found' } }
        return { body: detail }
      } catch (err) {
        logger.error({ err }, '[Manga] info failed')
        return { status: 500, body: { error: 'Failed to load manga' } }
      }
    })
  }),

  pages: protectedProcedure.input(mangaPagesInput()).query(async ({ ctx, input }) => {
    const provider = String(input.provider || '')
    const id = String(input.id || '')
    return cached(ctx, `route-manga-pages-${provider}-${id}`, 300, async () => {
      try {
        if (!id) return { status: 400, body: { error: 'Missing id' } }
        const pages = (await pick(ctx, provider as string as MangaProviderName)?.getPages(id)) ?? []
        return { body: { pages } }
      } catch (err) {
        logger.error({ err }, '[Manga] pages failed')
        return { body: { pages: [] } }
      }
    })
  }),
})
