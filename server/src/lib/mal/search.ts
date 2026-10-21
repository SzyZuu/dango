import type { AnilistMedia, AnilistSearchOptions } from '../anilist.js'
import { kitsuTitlesByMalIds } from '../kitsu/index.js'
import type { KitsuTitles } from '../kitsu/index.js'
import { decodeHtml } from '../html.js'
import { filterMedia } from '../media-filter.js'
import {
  DEFAULT_TTL_SECONDS,
  detailToSearchEntry,
  fetchHtml,
  firstImage,
  infoField,
  numeric,
  parseDetail,
  parseSearchResults,
  toAnilistSearchMedia,
  toAnilistDetailMedia,
  UA,
} from './scraper.js'
import type { MalCacheStore, ScrapedDetail, ScrapedSearchEntry } from './types.js'

export async function malSearchAnime(
  store: MalCacheStore,
  query: string,
  page = 1
): Promise<{ entries: ScrapedSearchEntry[]; cached: boolean; ms: number }> {
  const key = `mal:search:anime:${query.toLowerCase()}:page:${page}`
  const hit = store.get(key)
  if (hit && hit.fresh) {
    return { entries: JSON.parse(hit.payload) as ScrapedSearchEntry[], cached: true, ms: 0 }
  }
  const t0 = Date.now()
  const show = (page - 1) * 50
  const params = new URLSearchParams({ q: query, cat: 'anime' })
  if (show > 0) params.set('show', String(show))
  const res = await fetchHtml(`https://myanimelist.net/anime.php?${params.toString()}`)
  const ms = Date.now() - t0
  if (res.status !== 200) {
    if (hit) return { entries: JSON.parse(hit.payload) as ScrapedSearchEntry[], cached: true, ms }
    throw new Error(`MAL search failed with status ${res.status}`)
  }
  const detailMatch = res.url.match(/myanimelist\.net\/anime\/(\d+)/i)
  if (detailMatch && !res.html.includes('Search Anime - MyAnimeList.net')) {
    const detail = parseDetail(res.html, Number(detailMatch[1]))
    const entries = detail ? [detailToSearchEntry(detail)] : []
    if (entries.length > 0) store.put(key, JSON.stringify(entries), DEFAULT_TTL_SECONDS)
    return { entries, cached: false, ms }
  }
  const entries = parseSearchResults(res.html)
  store.put(key, JSON.stringify(entries), DEFAULT_TTL_SECONDS)
  return { entries, cached: false, ms }
}

export async function malAnimeDetail(
  store: MalCacheStore,
  malId: number
): Promise<{ detail: ScrapedDetail | null; cached: boolean; ms: number }> {
  const key = `mal:detail:anime:${malId}`
  const hit = store.get(key)
  if (hit && hit.fresh) {
    return { detail: JSON.parse(hit.payload) as ScrapedDetail, cached: true, ms: 0 }
  }
  const t0 = Date.now()
  const { status, html } = await fetchHtml(`https://myanimelist.net/anime/${malId}`)
  const ms = Date.now() - t0
  if (status !== 200) {
    if (hit) return { detail: JSON.parse(hit.payload) as ScrapedDetail, cached: true, ms }
    throw new Error(`MAL detail failed with status ${status}`)
  }
  const detail = parseDetail(html, malId)
  if (detail) store.put(key, JSON.stringify(detail), DEFAULT_TTL_SECONDS)
  return { detail, cached: false, ms }
}

const MAL_TYPE_IDS: Record<string, string> = {
  tv: '1',
  ova: '2',
  movie: '3',
  special: '4',
  ona: '5',
  music: '6',
}

const MAL_STATUS_IDS: Record<string, string | undefined> = {
  airing: '1',
  complete: '2',
  finished: '2',
  upcoming: '3',
  hiatus: '3',
  cancelled: undefined,
  not_yet_released: '3',
}

const MAL_ORDER_IDS: Record<string, string> = {
  start_date: '2',
  score: '3',
  episodes: '4',
  end_date: '5',
  type: '6',
  members: '7',
  rating: '8',
  mal_id: '9',
}

const ORDER_BY_MAP: Record<string, string> = {
  POPULARITY_DESC: 'members',
  SCORE_DESC: 'score',
  TRENDING_DESC: 'members',
  START_DATE_DESC: 'start_date',
  END_DATE_DESC: 'end_date',
  EPISODES_DESC: 'episodes',
  FAVOURITES_DESC: 'members',
  UPDATED_AT_DESC: 'start_date',
}

export const SEASON_START_MONTH: Record<string, string> = {
  WINTER: '01',
  SPRING: '04',
  SUMMER: '07',
  FALL: '10',
}

export const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

export const SCHEDULE_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

export const CARD_TYPE_BY_ID: Record<string, string> = {
  '0': 'Unknown',
  '1': 'TV',
  '2': 'OVA',
  '3': 'Movie',
  '4': 'Special',
  '5': 'ONA',
  '9': 'TV Special',
}

async function resolveGenreIds(store: MalCacheStore, genre: string): Promise<string | null> {
  const cached = store.get('taxonomy:anime:genres')
  let map: Record<string, number>
  if (cached && cached.fresh) {
    map = JSON.parse(cached.payload) as Record<string, number>
  } else {
    const { status, html } = await fetchHtml('https://myanimelist.net/anime.php?cat=genre')
    if (status !== 200) {
      if (cached) {
        map = JSON.parse(cached.payload) as Record<string, number>
      } else {
        return null
      }
    } else {
      map = {}
      for (const m of html.matchAll(/\/anime\/genre\/(\d+)\/[^"']*"[^>]*>([^<]+)</gi)) {
        map[decodeHtml(m[2]).trim().toLowerCase()] = Number(m[1])
      }
      store.put('taxonomy:anime:genres', JSON.stringify(map), 24 * 3600)
    }
  }
  const ids: number[] = []
  for (const part of genre.split(',')) {
    const name = part.trim().toLowerCase()
    if (!name) continue
    if (/^\d+$/.test(name)) {
      ids.push(parseInt(name, 10))
      continue
    }
    const id = map[name]
    if (id == null) return null
    ids.push(id)
  }
  return ids.length > 0 ? [...new Set(ids)].join(',') : null
}

interface SeasonalCard {
  malId: number
  title: string
  imageUrl: string | null
  score: number | null
  type: string | null
  episodes: number | null
  startDate: string | null
  members: number | null
  genreIds: number[]
}

export function parseSeasonalCard(chunk: string): SeasonalCard | null {
  const link = chunk.match(
    /<a href="https:\/\/myanimelist\.net\/anime\/(\d+)\/[^"]*" class="link-title">([^<]+)<\/a>/i
  )
  if (!link) return null
  const typeId = chunk.slice(0, 200).match(/js-anime-type-(\d+)/)?.[1]
  return {
    malId: Number(link[1]),
    title: decodeHtml(link[2]),
    imageUrl: firstImage(chunk),
    score: numeric(chunk.match(/class="js-score">([\d.]+)<\/span>/i)?.[1] ?? null),
    type: typeId === undefined ? null : (CARD_TYPE_BY_ID[typeId] ?? null),
    episodes: numeric(chunk.match(/<span>(\d+)\s*eps?<\/span>/i)?.[1] ?? null),
    startDate: chunk.match(/class="js-start_date">(\d+)<\/span>/i)?.[1] ?? null,
    members: numeric(chunk.match(/class="js-members">(\d+)<\/span>/i)?.[1] ?? null),
    genreIds: (chunk.match(/data-genre="([\d,]+)"/i)?.[1] ?? '')
      .split(',')
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0),
  }
}

export function parseSeasonalCards(html: string): SeasonalCard[] {
  const out = new Map<number, SeasonalCard>()
  for (const chunk of html.split('js-seasonal-anime').slice(1)) {
    const card = parseSeasonalCard(chunk)
    if (card) out.set(card.malId, card)
  }
  return [...out.values()]
}

export function startDateParts(value: string | null): {
  year?: number
  month?: number
  day?: number
} {
  const m = value?.match(/^(\d{4})(\d{2})(\d{2})/)
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
  const t = value?.match(/([A-Za-z]+)\s+(\d{4})/)
  if (t) {
    const month = MONTH_INDEX[t[1].toLowerCase()]
    if (month) return { year: Number(t[2]), month }
  }
  return {}
}

export function cardToMedia(c: SeasonalCard): AnilistMedia {
  const startDate = startDateParts(c.startDate)
  const cover = c.imageUrl || undefined
  return {
    id: -c.malId,
    idMal: c.malId,
    title: { romaji: c.title, english: c.title, native: c.title },
    coverImage: cover ? { extraLarge: cover, large: cover, medium: cover } : undefined,
    description: null,
    averageScore: c.score != null ? Math.round(c.score * 10) : null,
    format: c.type?.toUpperCase(),
    episodes: c.episodes,
    seasonYear: startDate.year,
    startDate,
    popularity: c.members ?? undefined,
    isAdult: c.genreIds.includes(12),
  }
}

export function cachedFetch(
  store: MalCacheStore,
  key: string,
  url: string
): Promise<{ html: string; cached: boolean }> {
  const hit = store.get(key)
  if (hit && hit.fresh) return Promise.resolve({ html: hit.payload, cached: true })
  return fetchHtml(url).then(({ status, html }) => {
    if (status !== 200) {
      if (hit) return { html: hit.payload, cached: true }
      throw new Error(`MAL fetch failed with status ${status} for ${url}`)
    }
    store.put(key, html, DEFAULT_TTL_SECONDS)
    return { html, cached: false }
  })
}

const TITLE_TTL_SECONDS = 7 * 24 * 3600
const EN_TITLE_TTL_SECONDS = 7 * 24 * 3600
const EN_TITLE_FETCH_TIMEOUT_MS = 10000
const EN_TITLE_TOP_N = 10
export const EN_TITLE_CACHE_PREFIX = 'mal:en-title:'

function needsEnglishTitle(m: AnilistMedia): boolean {
  const romaji = m.title?.romaji?.trim() ?? ''
  const english = m.title?.english?.trim() ?? ''
  return !!m.idMal && (!english || (!!romaji && english === romaji))
}

function cleanEnTitle(raw: string | null, romaji?: string): string | null {
  const t = (raw ?? '').trim()
  if (!t || /^(unknown|n\/a|-)$/i.test(t)) return null
  if (romaji && t.toLowerCase() === romaji.trim().toLowerCase()) return null
  return t
}

export async function enrichEnglishFromMalDetail(
  store: MalCacheStore,
  items: AnilistMedia[],
  limit: number = EN_TITLE_TOP_N
): Promise<AnilistMedia[]> {
  const targets = items.filter(needsEnglishTitle).slice(0, Math.max(0, limit))
  if (targets.length === 0) return items
  await Promise.all(
    targets.map(async (m) => {
      const malId = m.idMal as number
      const key = `${EN_TITLE_CACHE_PREFIX}${malId}`
      try {
        const hit = store.get(key)
        if (hit && typeof hit.payload === 'string') {
          const titleEnglish = cleanEnTitle(hit.payload, m.title?.romaji)
          if (titleEnglish && m.title) m.title = { ...m.title, english: titleEnglish }
          return
        }
        const res = await fetch(`https://myanimelist.net/anime/${malId}`, {
          headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
          signal: AbortSignal.timeout(EN_TITLE_FETCH_TIMEOUT_MS),
          redirect: 'follow',
        })
        if (res.status !== 200) return
        const html = await res.text()
        const raw = infoField(html, 'English')
        try {
          store.put(key, (raw ?? '').trim(), EN_TITLE_TTL_SECONDS)
        } catch {
          // ignore
        }
        const titleEnglish = cleanEnTitle(raw, m.title?.romaji)
        if (!titleEnglish) return
        if (m.title) m.title = { ...m.title, english: titleEnglish }
      } catch {
        // ignore
      }
    })
  )
  return items
}

export async function enrichCardTitles(
  store: MalCacheStore,
  items: AnilistMedia[]
): Promise<AnilistMedia[]> {
  const cached = new Map<number, KitsuTitles>()
  const missing: number[] = []
  for (const m of items) {
    if (!m.idMal) continue
    const hit = store.get(`mal:title:${m.idMal}`)
    if (hit) {
      try {
        cached.set(m.idMal, JSON.parse(hit.payload) as KitsuTitles)
        continue
      } catch {
        // ignore
      }
    }
    missing.push(m.idMal)
  }
  let fetched = new Map<number, KitsuTitles>()
  if (missing.length > 0) {
    try {
      fetched = await kitsuTitlesByMalIds(missing)
    } catch {
      // ignore
    }
    for (const [id, t] of fetched) {
      store.put(`mal:title:${id}`, JSON.stringify(t), TITLE_TTL_SECONDS)
    }
  }
  for (const m of items) {
    if (!m.idMal) continue
    const t = cached.get(m.idMal) ?? fetched.get(m.idMal)
    if (t?.english || t?.native) {
      m.title = {
        romaji: m.title?.romaji,
        english: t.english ?? m.title?.english,
        native: t.native ?? m.title?.native,
      }
    }
  }
  return items
}

export async function malSearchMedia(
  store: MalCacheStore,
  options: AnilistSearchOptions = {},
  enrichTitles = true
): Promise<AnilistMedia[]> {
  const {
    query,
    page = 1,
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

  const params = new URLSearchParams()
  const trimmedQuery = query?.trim()
  const hasQuery = !!trimmedQuery
  if (trimmedQuery) params.set('q', trimmedQuery)
  params.set('cat', 'anime')
  if (page > 1) params.set('show', String((page - 1) * 50))
  const clientFormat = isAdult ? format : undefined
  if (format && format !== 'ALL' && format !== 'ADULT' && !isAdult) {
    const typeId = MAL_TYPE_IDS[format.toLowerCase()]
    if (typeId) params.set('type', typeId)
  }
  if (status) {
    const statusId = MAL_STATUS_IDS[status.toLowerCase()]
    if (statusId) params.set('status', statusId)
  }
  const genreCombined = [
    ...(Array.isArray(genre) ? genre : typeof genre === 'string' ? genre.split(',') : []),
    ...(genre_in ?? []),
  ]
    .map((g) => g.trim())
    .filter(Boolean)
    .join(',')
  if (genreCombined) {
    const ids = await resolveGenreIds(store, genreCombined)
    if (!ids) return []
    for (const id of ids.split(',')) params.append('genre[]', id)
  }
  if (seasonYear) {
    const month =
      season && season !== 'ALL' ? (SEASON_START_MONTH[season.toUpperCase()] ?? '01') : '01'
    params.set('sm', String(Number(month)))
    params.set('sd', '1')
    params.set('sy', String(seasonYear))
  }
  if (averageScore_greater) params.set('score', String(averageScore_greater))
  if (isAdult) {
    params.set('r', '6')
    params.append('genre[]', '12')
  }

  const wantOrder = sort ? ORDER_BY_MAP[sort] || 'members' : undefined
  const wantDir = sort && sort.includes('ASC') ? '2' : '1'
  if (wantOrder) {
    params.set('o', MAL_ORDER_IDS[wantOrder])
    params.set('w', wantDir)
  }

  const url = `https://myanimelist.net/anime.php?${params.toString()}`
  const key = `mal:search:${params.toString()}:page:${page}`
  const finish = (list: AnilistMedia[]): Promise<AnilistMedia[]> =>
    enrichTitles ? enrichCardTitles(store, list) : Promise.resolve(list)
  let serverSorted = false
  let html: string
  try {
    const hit = store.get(key)
    if (hit && hit.fresh) {
      return finish(
        filterMedia(parseSearchResults(hit.payload).map(toAnilistSearchMedia), {
          genre_not_in,
          episodes_greater,
          format: clientFormat,
          seasonYear,
          season,
          sort: serverSorted ? undefined : sort,
          hasQuery,
        })
      )
    }
    const res = await fetchHtml(url)
    if (res.status !== 200) {
      if (hit) {
        return finish(
          filterMedia(parseSearchResults(hit.payload).map(toAnilistSearchMedia), {
            genre_not_in,
            episodes_greater,
            format: clientFormat,
            seasonYear,
            season: undefined,
            sort: undefined,
            hasQuery,
          })
        )
      }
      throw new Error(`MAL search failed with status ${res.status}`)
    }
    const detailMatch = res.url.match(/myanimelist\.net\/anime\/(\d+)/i)
    if (detailMatch && !res.html.includes('Search Anime - MyAnimeList.net')) {
      const detail = parseDetail(res.html, Number(detailMatch[1]))
      const list = detail ? [toAnilistDetailMedia(detail)] : []
      store.put(key, JSON.stringify(list.map((m) => m.idMal)))
      return list
    }
    serverSorted = !!wantOrder
    store.put(key, res.html, DEFAULT_TTL_SECONDS)
    html = res.html
  } catch {
    const hit = store.get(key)
    if (hit) {
      try {
        const cached = JSON.parse(hit.payload) as unknown
        if (Array.isArray(cached) && cached.every((e) => typeof e === 'number')) {
          return []
        }
      } catch {
        // ignore
      }
      return finish(
        filterMedia(parseSearchResults(hit.payload).map(toAnilistSearchMedia), {
          genre_not_in,
          episodes_greater,
          format: clientFormat,
          seasonYear,
          season: undefined,
          sort: undefined,
          hasQuery,
        })
      )
    }
    return []
  }
  return finish(
    filterMedia(parseSearchResults(html).map(toAnilistSearchMedia), {
      genre_not_in,
      episodes_greater,
      format: clientFormat,
      seasonYear,
      season,
      sort: serverSorted ? undefined : sort,
      hasQuery,
    })
  )
}
