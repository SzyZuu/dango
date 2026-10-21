import type { AnilistMedia } from '../anilist.js'
import { parseJsonBody } from '../../utils/http.utils.js'
import { decodeHtml } from '../html.js'
import { startDateRank } from '../media-filter.js'
import {
  cachedFetch,
  cardToMedia,
  enrichCardTitles,
  malSearchMedia,
  parseSeasonalCards,
  SCHEDULE_DAYS,
  MONTH_INDEX,
} from './search.js'
import { firstImage, numeric, politeWait, TIMEOUT_MS, UA } from './scraper.js'
import type { MalCacheStore } from './types.js'

export async function malSearchTitle(store: MalCacheStore, title: string): Promise<string | null> {
  const results = await malSearchMedia(store, { query: title, page: 1, perPage: 5 }, false)
  const first = results[0]
  if (!first?.idMal) return null
  return `mal-${first.idMal}`
}

export async function malTop(
  store: MalCacheStore,
  filter: 'airing' | 'bypopularity' | null,
  page = 1
): Promise<AnilistMedia[]> {
  const limit = (page - 1) * 50
  const params = new URLSearchParams()
  if (filter) params.set('type', filter)
  if (limit > 0) params.set('limit', String(limit))
  const query = params.toString()
  const url = query
    ? `https://myanimelist.net/topanime.php?${query}`
    : 'https://myanimelist.net/topanime.php'
  const key = `mal:top:${filter ?? 'all'}:page:${page}`
  const { html } = await cachedFetch(store, key, url)
  const out: AnilistMedia[] = []
  for (const match of html.matchAll(/<tr class="ranking-list">([\s\S]*?)<\/tr>/gi)) {
    const row = match[1]
    const malId = Number(row.match(/href="https:\/\/myanimelist\.net\/anime\/(\d+)\//i)?.[1])
    if (!malId) continue
    const imgTag = row.match(/<img[^>]*alt="Anime: ([^"]+)"[^>]*>/i)
    const title = imgTag ? decodeHtml(imgTag[1]) : ''
    if (!title) continue
    const info = row.match(/<div class="information[^"]*">([\s\S]*?)<\/div>/i)?.[1] ?? ''
    const segments = info.split(/<br\s*\/?>/i).map((s: string) => decodeHtml(s))
    const typeEpisodes = segments[0] ?? ''
    const dateText = segments[1] ?? ''
    const membersText = segments[2] ?? ''
    const dateMatch = dateText.match(/([A-Za-z]+)\s+(\d{4})/)
    const month = dateMatch ? MONTH_INDEX[dateMatch[1].toLowerCase()] : undefined
    const score = numeric(
      row.match(/class="text on score-label[^"]*">([\d.]+)<\/span>/i)?.[1] ?? null
    )
    out.push({
      id: -malId,
      idMal: malId,
      title: { romaji: title, english: title, native: title },
      coverImage: undefined,
      description: null,
      averageScore: score != null ? Math.round(score * 10) : null,
      format: typeEpisodes.match(/^(\S+)/)?.[1]?.toUpperCase(),
      episodes: (() => {
        const m = typeEpisodes.match(/\((\d+)/)
        return m ? Number(m[1]) : null
      })(),
      startDate: month != null && dateMatch ? { year: Number(dateMatch[2]), month } : undefined,
      popularity: numeric(membersText.match(/([\d,]+)/)?.[1] ?? null) ?? undefined,
    })
    const img = row.match(/<img[^>]*>/i)?.[0] ?? ''
    const imageUrl = firstImage(img)
    if (imageUrl) {
      const last = out[out.length - 1]
      last.coverImage = { extraLarge: imageUrl, large: imageUrl, medium: imageUrl }
    }
  }
  return enrichCardTitles(store, out)
}

export async function malSeasonal(
  store: MalCacheStore,
  season: string,
  year: number,
  format?: string,
  page = 1,
  size = 14
): Promise<AnilistMedia[]> {
  const key = `mal:season:${year}:${season.toLowerCase()}`
  const { html } = await cachedFetch(
    store,
    key,
    `https://myanimelist.net/anime/season/${year}/${season.toLowerCase()}`
  )
  let all = parseSeasonalCards(html).map(cardToMedia)
  if (format && format !== 'ALL' && format !== 'ADULT') {
    const f = format.toUpperCase()
    all = all.filter((m) => (m.format ?? '').toUpperCase() === f)
  }
  all = [...all].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
  const offset = (page - 1) * size
  return enrichCardTitles(store, all.slice(offset, offset + size))
}

export async function malScheduleWeek(
  store: MalCacheStore
): Promise<Record<string, AnilistMedia[]>> {
  const key = 'mal:schedule:week'
  const { html } = await cachedFetch(store, key, 'https://myanimelist.net/anime/season/schedule')
  const out: Record<string, AnilistMedia[]> = {}
  for (const section of html.split('class="anime-header">').slice(1)) {
    const day = section
      .slice(0, 40)
      .match(/^([A-Za-z]+)</)?.[1]
      ?.toLowerCase()
    if (!day || !SCHEDULE_DAYS.includes(day)) continue
    out[day] = parseSeasonalCards(section).map(cardToMedia)
  }
  return out
}

export interface MalUserListEntry {
  malId: number
  title: string
  titleEnglish: string | null
  status: number
  score: number
  watchedEpisodes: number
  totalEpisodes: number
  type: string | null
  imageUrl: string | null
}

const MAL_USER_LIST_PAGE_SIZE = 300
const MAL_USER_LIST_MAX_PAGES = 100

export async function fetchMalUserList(username: string): Promise<MalUserListEntry[]> {
  const user = username.trim()
  if (!user || /[^A-Za-z0-9_-]/.test(user)) throw new Error('Invalid MAL username')
  const entries: MalUserListEntry[] = []
  let offset = 0
  for (let page = 0; page < MAL_USER_LIST_MAX_PAGES; page++) {
    const url = `https://myanimelist.net/animelist/${encodeURIComponent(user)}/load.json?status=7&offset=${offset}`
    await politeWait()
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
    })
    if (res.status === 400 || res.status === 404) throw new Error(`MAL user "${user}" not found`)
    if (res.status === 403 || res.status === 429) {
      throw new Error(`MAL blocked the request (HTTP ${res.status}) - try again later`)
    }
    if (res.status >= 300 && res.status < 400) {
      throw new Error(`MAL list for "${user}" is private or unavailable`)
    }
    if (!res.ok) throw new Error(`MAL list fetch failed (HTTP ${res.status})`)
    const data: unknown = await parseJsonBody(res)
    if (!Array.isArray(data) || data.length === 0) break
    for (const item of data) {
      const rec = item as Record<string, unknown>
      const malId = Number(rec.anime_id)
      if (!malId) continue
      const titleRaw =
        typeof rec.anime_title === 'string' && rec.anime_title.trim() !== ''
          ? rec.anime_title
          : typeof rec.anime_title_eng === 'string'
            ? rec.anime_title_eng
            : ''
      entries.push({
        malId,
        title: decodeHtml(titleRaw),
        titleEnglish:
          typeof rec.anime_title_eng === 'string' && rec.anime_title_eng.trim() !== ''
            ? decodeHtml(rec.anime_title_eng)
            : null,
        status: Number(rec.status) || 0,
        score: Number(rec.score) || 0,
        watchedEpisodes: Number(rec.num_watched_episodes) || 0,
        totalEpisodes: Number(rec.anime_num_episodes) || 0,
        type: typeof rec.anime_media_type_string === 'string' ? rec.anime_media_type_string : null,
        imageUrl: typeof rec.anime_image_path === 'string' ? rec.anime_image_path : null,
      })
    }
    if (data.length < MAL_USER_LIST_PAGE_SIZE) break
    offset += MAL_USER_LIST_PAGE_SIZE
  }
  return entries
}

export interface MalMangaListEntry {
  malId: number
  title: string
  titleEnglish: string | null
  status: number
  chaptersRead: number
}

export function mapMalMangaStatusCode(status: number): string | null {
  switch (status) {
    case 1:
      return 'Reading'
    case 2:
      return 'Completed'
    case 3:
      return 'On-Hold'
    case 4:
      return 'Dropped'
    case 6:
      return 'Planned'
    default:
      return null
  }
}

export async function fetchMalMangaList(username: string): Promise<MalMangaListEntry[]> {
  const user = username.trim()
  if (!user || /[^A-Za-z0-9_-]/.test(user)) throw new Error('Invalid MAL username')
  const entries: MalMangaListEntry[] = []
  let offset = 0
  for (let page = 0; page < MAL_USER_LIST_MAX_PAGES; page++) {
    const url = `https://myanimelist.net/mangalist/${encodeURIComponent(user)}/load.json?status=7&offset=${offset}`
    await politeWait()
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
    })
    if (res.status === 400 || res.status === 404) throw new Error(`MAL user "${user}" not found`)
    if (res.status === 403 || res.status === 429) {
      throw new Error(`MAL blocked the request (HTTP ${res.status}) - try again later`)
    }
    if (res.status >= 300 && res.status < 400) {
      throw new Error(`MAL list for "${user}" is private or unavailable`)
    }
    if (!res.ok) throw new Error(`MAL list fetch failed (HTTP ${res.status})`)
    const data: unknown = await parseJsonBody(res)
    if (!Array.isArray(data) || data.length === 0) break
    for (const item of data) {
      const rec = item as Record<string, unknown>
      const malId = Number(rec.manga_id)
      if (!malId) continue
      const titleRaw =
        typeof rec.manga_title === 'string' && rec.manga_title.trim() !== ''
          ? rec.manga_title
          : typeof rec.manga_title_eng === 'string'
            ? rec.manga_title_eng
            : ''
      entries.push({
        malId,
        title: decodeHtml(titleRaw),
        titleEnglish:
          typeof rec.manga_title_eng === 'string' && rec.manga_title_eng.trim() !== ''
            ? decodeHtml(rec.manga_title_eng)
            : null,
        status: Number(rec.status) || 0,
        chaptersRead: Number(rec.num_read_chapters ?? rec.num_chapters_read) || 0,
      })
    }
    if (data.length < MAL_USER_LIST_PAGE_SIZE) break
    offset += MAL_USER_LIST_PAGE_SIZE
  }
  return entries
}

export async function malLatestReleases(
  store: MalCacheStore,
  format: string = 'TV',
  page = 1,
  size = 12
): Promise<AnilistMedia[]> {
  const week = await malScheduleWeek(store)
  const seen = new Map<number, AnilistMedia>()
  for (const day of SCHEDULE_DAYS) {
    for (const m of week[day] ?? []) {
      if (!seen.has(m.id)) seen.set(m.id, m)
    }
  }
  let all = [...seen.values()]
  if (format && format !== 'ALL') {
    const f = format.toUpperCase()
    all = all.filter((m) => (m.format ?? '').toUpperCase() === f)
  }
  all.sort(
    (a, b) => startDateRank(b) - startDateRank(a) || (b.popularity ?? 0) - (a.popularity ?? 0)
  )
  const offset = (page - 1) * size
  return enrichCardTitles(store, all.slice(offset, offset + size))
}
