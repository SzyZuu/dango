import type { AnilistMedia } from '../anilist.js'
import { filterMedia, startDateRank } from '../media-filter.js'
import { asArray, kitsuFetch, type KitsuEntry } from './client.js'
import {
  anilistSortToKitsu,
  dedupeKitsuMedia,
  normalizeKitsuEntry,
  seasonToKitsu,
  statusToKitsuFilter,
  KITSU_STATUS_MAP,
} from './normalize.js'

export interface KitsuSearchOptions {
  query?: string
  page?: number
  perPage?: number
  format?: string
  status?: string
  season?: string
  seasonYear?: number
  genre?: string | string[]
  genre_in?: string[]
  genre_not_in?: string[]
  averageScore_greater?: number
  episodes_greater?: number
  isAdult?: boolean
  sort?: string
}

function mappingItem(entry: KitsuEntry, included: KitsuEntry[]): KitsuEntry | undefined {
  const rel = entry.relationships?.item?.data
  if (!rel) return undefined
  if (Array.isArray(rel)) return undefined
  return included.find((i) => i.type === rel.type && i.id === rel.id)
}

export async function kitsuSearchAnime(options: KitsuSearchOptions = {}): Promise<AnilistMedia[]> {
  const {
    query,
    page = 1,
    perPage = 14,
    format,
    status,
    season,
    seasonYear,
    genre,
    genre_in,
    genre_not_in,
    averageScore_greater,
    episodes_greater,
    isAdult,
    sort,
  } = options

  const filters: string[] = []
  if (query) filters.push(`filter[text]=${encodeURIComponent(query)}`)
  if (format && format !== 'ALL' && format !== 'ADULT') {
    filters.push(`filter[subtype]=${format.toLowerCase()}`)
  }
  const statusFilter = statusToKitsuFilter(status)
  if (statusFilter) filters.push(`filter[status]=${statusFilter}`)
  const seasonFilter = seasonToKitsu(season)
  if (seasonFilter && seasonFilter !== 'all') filters.push(`filter[season]=${seasonFilter}`)
  if (seasonYear) filters.push(`filter[seasonYear]=${seasonYear}`)
  const genreCombined = [
    ...(Array.isArray(genre) ? genre : typeof genre === 'string' ? genre.split(',') : []),
    ...(genre_in ?? []),
  ]
    .map((g) => g.trim())
    .filter(Boolean)
    .join(',')
  if (genreCombined) filters.push(`filter[categories]=${encodeURIComponent(genreCombined)}`)

  const offset = (page - 1) * perPage
  const path = `/anime?${filters.join('&')}${filters.length ? '&' : ''}sort=${anilistSortToKitsu(
    sort
  )}&page[limit]=${perPage}&page[offset]=${offset}&include=mappings,categories`

  const json = await kitsuFetch(path)
  if (!json) return []
  const entries = asArray(json.data)
  const included = json.included ?? []

  const results: AnilistMedia[] = []
  for (const entry of entries) {
    const media = normalizeKitsuEntry(entry, included)
    if (!media) continue
    results.push(media)
  }

  return filterMedia(results, { genre_not_in, averageScore_greater, episodes_greater, isAdult })
}

async function kitsuIdByAnilistId(anilistId: number): Promise<string | null> {
  const json = await kitsuFetch(
    `/mappings?filter[externalSite]=anilist%2Fanime&filter[externalId]=${anilistId}&include=item`
  )
  const entries = asArray(json?.data)
  if (entries.length === 0) return null
  return mappingItem(entries[0], json?.included ?? [])?.id ?? null
}

export async function kitsuBatchGetStatuses(anilistIds: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  for (const id of anilistIds) {
    try {
      const json = await kitsuFetch(
        `/mappings?filter[externalSite]=anilist%2Fanime&filter[externalId]=${id}&include=item`
      )
      const entries = asArray(json?.data)
      if (entries.length === 0) continue
      const included = json?.included ?? []
      const entry = entries[0]
      const rel = entry.relationships?.item?.data
      if (!rel) continue
      const relSingle = Array.isArray(rel) ? rel[0] : rel
      if (!relSingle) continue
      const anime = included.find((i) => i.id === relSingle.id && i.type === 'anime')
      if (!anime) continue
      const raw = (anime.attributes?.status as string | undefined)?.toLowerCase()
      const status = raw ? (KITSU_STATUS_MAP[raw] ?? raw.toUpperCase()) : undefined
      if (status) result.set(id, status)
    } catch {
      // ignore
    }
  }
  return result
}

async function kitsuDetail(
  kitsuId: string,
  knownIds?: { anilistId?: number | null; malId?: number | null }
): Promise<AnilistMedia | null> {
  const [animeJson, studiosJson] = await Promise.all([
    kitsuFetch(`/anime/${kitsuId}?include=categories,mappings`),
    kitsuFetch(`/anime/${kitsuId}/anime-productions?include=producer&page[limit]=10`),
  ])
  if (!animeJson) return null

  const entry = asArray(animeJson.data)[0]
  if (!entry) return null

  const media = normalizeKitsuEntry(entry, animeJson.included ?? [], knownIds)
  if (!media) return null

  const producers = (studiosJson?.included ?? [])
    .filter((i) => i.type === 'producers')
    .map((i) => ({ id: 0, name: (i.attributes?.name as string | undefined) ?? '' }))
    .filter((p) => p.name.length > 0)

  if (producers.length > 0) {
    media.studios = { nodes: producers }
  }

  return media
}

export async function kitsuMetaByAnilistId(anilistId: number): Promise<AnilistMedia | null> {
  const kitsuId = await kitsuIdByAnilistId(anilistId)
  if (!kitsuId) return null
  return kitsuDetail(kitsuId, { anilistId })
}

export async function kitsuMetaByMalId(malId: number): Promise<AnilistMedia | null> {
  const json = await kitsuFetch(
    `/mappings?filter[externalSite]=myanimelist%2Fanime&filter[externalId]=${malId}&include=item`
  )
  const entries = asArray(json?.data)
  if (entries.length === 0) return null
  const item = mappingItem(entries[0], json?.included ?? [])
  if (!item) return null
  return kitsuDetail(item.id, { malId })
}

export interface KitsuTitles {
  english?: string
  native?: string
}

export async function kitsuTitlesByMalIds(malIds: number[]): Promise<Map<number, KitsuTitles>> {
  const result = new Map<number, KitsuTitles>()
  const unique = [...new Set(malIds.filter((n) => Number.isFinite(n) && n > 0))]
  const CHUNK = 20
  const chunks: number[][] = []
  for (let i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK))
  await Promise.all(
    chunks.map(async (ids) => {
      try {
        const json = await kitsuFetch(
          `/mappings?filter[externalSite]=myanimelist%2Fanime&filter[externalId]=${ids.join(',')}&include=item&page[limit]=${CHUNK}`
        )
        if (!json) return
        const animeById = new Map<string, KitsuEntry>()
        for (const inc of json.included ?? []) {
          if (inc.type === 'anime') animeById.set(inc.id, inc)
        }
        for (const entry of asArray(json.data)) {
          const rel = entry.relationships?.item?.data
          const single = Array.isArray(rel) ? rel[0] : rel
          if (!single) continue
          const titles = (animeById.get(single.id)?.attributes?.titles ?? {}) as Record<
            string,
            string | undefined
          >
          const english = titles.en || titles.en_us || undefined
          const native = titles.ja_jp || undefined
          if (!english && !native) continue
          const malId = Number(entry.attributes?.externalId as string | number | undefined)
          if (!Number.isFinite(malId) || malId <= 0) continue
          result.set(malId, { english, native })
        }
      } catch {
        // ignore
      }
    })
  )
  return result
}

export async function kitsuEpisodes(anilistId: number, idMal: number | null): Promise<string[]> {
  let kitsuId: string | null = null
  if (anilistId > 0) kitsuId = await kitsuIdByAnilistId(anilistId)
  if (!kitsuId && idMal != null) {
    const json = await kitsuFetch(
      `/mappings?filter[externalSite]=myanimelist%2Fanime&filter[externalId]=${idMal}&include=item`
    )
    const entries = asArray(json?.data)
    if (entries.length > 0) {
      kitsuId = mappingItem(entries[0], json?.included ?? [])?.id ?? null
    }
  }
  if (!kitsuId) return []

  const all: number[] = []
  const LIMIT = 20
  let offset = 0
  while (offset < 1000) {
    const json = await kitsuFetch(
      `/anime/${kitsuId}/episodes?page[limit]=${LIMIT}&page[offset]=${offset}&sort=number`
    )
    if (!json) break
    const entries = asArray(json.data)
    if (entries.length === 0) break
    for (const e of entries) {
      const n = e.attributes?.number as number | undefined
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) all.push(n)
    }
    if (entries.length < LIMIT) break
    offset += LIMIT
  }
  if (all.length === 0) return []
  const max = Math.max(...all)
  return Array.from({ length: max }, (_, i) => (i + 1).toString())
}

export async function kitsuTrending(
  page: number = 1,
  perPage: number = 20,
  status?: string
): Promise<AnilistMedia[]> {
  const statusFilter = statusToKitsuFilter(status)
  const filters = statusFilter ? `filter[status]=${statusFilter}` : ''
  const offset = (page - 1) * perPage
  const json = await kitsuFetch(
    `/anime?${filters}${filters ? '&' : ''}sort=-userCount&page[limit]=${perPage}&page[offset]=${offset}&include=mappings,categories`
  )
  if (!json) return []
  return dedupeKitsuMedia(
    asArray(json.data)
      .map((e) => normalizeKitsuEntry(e, json.included ?? []))
      .filter((m): m is AnilistMedia => m !== null)
  )
}

export async function kitsuSpotlight(
  page: number = 1,
  perPage: number = 20
): Promise<AnilistMedia[]> {
  const offset = (page - 1) * perPage
  const json = await kitsuFetch(
    `/anime?sort=-userCount&page[limit]=${perPage}&page[offset]=${offset}&include=mappings,categories`
  )
  if (!json) return []
  return dedupeKitsuMedia(
    asArray(json.data)
      .map((e) => normalizeKitsuEntry(e, json.included ?? []))
      .filter((m): m is AnilistMedia => m !== null)
      .filter((m) => !!m.bannerImage)
  )
}

export async function kitsuLatestReleases(
  format: string = 'TV',
  page: number = 1,
  size: number = 12
): Promise<AnilistMedia[]> {
  const needed = page * size
  const formatFilter = format && format !== 'ALL' ? `filter[subtype]=${format.toLowerCase()}` : ''
  const all: AnilistMedia[] = []
  let offset = 0
  const LIMIT = 20
  while (all.length < needed && offset < 500) {
    const json = await kitsuFetch(
      `/anime?filter[status]=current${formatFilter ? `&${formatFilter}` : ''}&sort=-startDate&page[limit]=${LIMIT}&page[offset]=${offset}&include=mappings,categories`
    )
    if (!json) break
    const entries = asArray(json.data)
    if (entries.length === 0) break
    for (const e of entries) {
      const m = normalizeKitsuEntry(e, json.included ?? [])
      if (!m) continue
      all.push(m)
    }
    offset += LIMIT
  }

  all.sort((a, b) => {
    const aNext = a.nextAiringEpisode?.airingAt ?? Number.MAX_SAFE_INTEGER
    const bNext = b.nextAiringEpisode?.airingAt ?? Number.MAX_SAFE_INTEGER
    if (aNext !== bNext) return aNext - bNext
    const aStart = startDateRank(a)
    const bStart = startDateRank(b)
    if (aStart !== bStart) return bStart - aStart
    return (b.popularity ?? 0) - (a.popularity ?? 0)
  })

  const start = (page - 1) * size
  return dedupeKitsuMedia(all.slice(start, start + size))
}

export async function kitsuSeasonal(
  season: string,
  year: number,
  format?: string,
  page: number = 1,
  size: number = 14
): Promise<AnilistMedia[]> {
  const filters = [`filter[season]=${seasonToKitsu(season)}`, `filter[seasonYear]=${year}`]
  if (format && format !== 'ALL' && format !== 'ADULT') {
    filters.push(`filter[subtype]=${format.toLowerCase()}`)
  }
  const offset = (page - 1) * size
  const json = await kitsuFetch(
    `/anime?${filters.join('&')}&sort=-userCount&page[limit]=${size}&page[offset]=${offset}&include=mappings,categories`
  )
  if (!json) return []
  return dedupeKitsuMedia(
    asArray(json.data)
      .map((e) => normalizeKitsuEntry(e, json.included ?? []))
      .filter((m): m is AnilistMedia => m !== null)
  )
}
